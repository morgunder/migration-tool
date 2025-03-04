import { useState, useCallback, useEffect } from 'react';
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Separator } from "./ui/separator";
import { Copy, ChevronRight } from "lucide-react";
import { toast } from "../lib/toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

type ColumnType = 'number' | 'boolean' | 'string' | 'timestamp';

interface ColumnInfo {
  name: string;
  type: ColumnType;
}

interface SchemaInfo {
  tableName: string;
  columns: ColumnInfo[];
}

const shouldQuoteIdentifier = (identifier: string): boolean => {
  return POSTGRES_RESERVED_WORDS.has(identifier.toLowerCase()) || 
         /[^a-zA-Z0-9_]/.test(identifier) || 
         /^[0-9]/.test(identifier);
};

const quoteIdentifier = (identifier: string): string => {
  return shouldQuoteIdentifier(identifier) ? `"${identifier}"` : identifier;
};

// PostgreSQL reserved words that need quoting
const POSTGRES_RESERVED_WORDS = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric',
  'authorization', 'binary', 'both', 'case', 'cast', 'check', 'collate', 'column',
  'constraint', 'create', 'cross', 'current_catalog', 'current_date', 'current_role',
  'current_time', 'current_timestamp', 'current_user', 'default', 'deferrable',
  'desc', 'distinct', 'do', 'else', 'end', 'except', 'false', 'fetch', 'for',
  'foreign', 'from', 'grant', 'group', 'having', 'in', 'initially', 'intersect',
  'into', 'lateral', 'leading', 'limit', 'localtime', 'localtimestamp', 'not',
  'null', 'offset', 'on', 'only', 'or', 'order', 'placing', 'primary', 'references',
  'returning', 'select', 'session_user', 'some', 'symmetric', 'table', 'then', 'to',
  'trailing', 'true', 'union', 'unique', 'user', 'using', 'variadic', 'when', 'where',
  'window', 'with'
]);

const parseSchema = (schema: string): SchemaInfo => {
  const columns: ColumnInfo[] = [];
  let extractedTableName = '';
  
  // Get all CREATE TABLE blocks
  const createTableBlocks = schema.split(/create\s+table/i);
  
  for (const block of createTableBlocks) {
    if (!block.trim()) continue;
    
    // Extract table name
    const tableNameMatch = block.match(/\s+([^\s(]+)/);
    if (tableNameMatch && tableNameMatch[1]) {
      extractedTableName = tableNameMatch[1].replace(/[;"]/g, '').trim();
    }
    
    // Find the opening parenthesis that starts the column definitions
    const startIndex = block.indexOf('(');
    if (startIndex === -1) continue;
    
    // Get the content between parentheses
    const endIndex = block.lastIndexOf(')');
    const columnDefinitions = block.substring(startIndex + 1, endIndex);
    
    // Process each line
    for (const line of columnDefinitions.split('\n')) {
      const match = line.match(/^\s*"?([^"]+)"?\s+([^,\s]+)/);
      if (!match) continue;
      
      const [, name, type] = match;
      
      // Determine column type
      let columnType: ColumnType = 'string';
      const lowerType = type.toLowerCase();
      
      if (name.startsWith('is_')) {
        columnType = 'boolean';
      } else if (name.endsWith('_at')) {
        columnType = 'timestamp';
      } else if (
        lowerType.includes('int') || 
        lowerType.includes('serial') || 
        lowerType.includes('decimal') || 
        lowerType.includes('numeric') ||
        lowerType.includes('float') ||
        lowerType.includes('double')
      ) {
        columnType = 'number';
      }
      
      columns.push({ name, type: columnType });
    }
  }
  
  return { tableName: extractedTableName, columns };
};

const makeSlugUnique = (slug: string, usedSlugs: Map<string, number>): string => {
  const baseSlug = slug.trim().toLowerCase();
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.set(baseSlug, 0);
    return baseSlug;
  }

  const count = usedSlugs.get(baseSlug)! + 1;
  usedSlugs.set(baseSlug, count);
  return `${baseSlug}-${count}`;
};

const formatValue = (value: string, type: ColumnType, columnName: string, usedSlugs?: Map<string, number>): string => {
  const trimmedVal = value.trim();
  
  if (!trimmedVal) return 'NULL';
  
  // Handle slug columns
  if (columnName === 'slug' && usedSlugs) {
    const uniqueSlug = makeSlugUnique(trimmedVal, usedSlugs);
    return `'${uniqueSlug}'`;
  }

  // Special case for NOW()
  const unquotedVal = trimmedVal.replace(/^['"](.+)['"]$/, '$1');
  if (unquotedVal.toUpperCase() === 'NOW()' || unquotedVal.toUpperCase() === 'NOW') {
    return 'NOW()';
  }
  
  switch (type) {
    case 'boolean': {
      const lowerVal = trimmedVal.toLowerCase();
      if (lowerVal === '1' || lowerVal === 'true' || lowerVal === 'yes') return 'TRUE';
      if (lowerVal === '0' || lowerVal === 'false' || lowerVal === 'no') return 'FALSE';
      return 'FALSE';
    }
      
    case 'number':
      return trimmedVal;
      
    case 'timestamp':
      if (trimmedVal.toUpperCase() === 'NULL') return 'NULL';
      return `'${trimmedVal.replace(/'/g, "''")}'`;
      
    default: // string
      // Only escape single quotes, don't worry about commas
      return `'${trimmedVal.replace(/'/g, "''")}'`;
  }
};

const CsvToSql = () => {
  const [schemaInput, setSchemaInput] = useState(() => {
    return localStorage.getItem('lastTableSchema') || '';
  });
  const [sqlOutput, setSqlOutput] = useState('');
  const [columnTypes, setColumnTypes] = useState<ColumnInfo[]>([]);
  const [extractedTableName, setExtractedTableName] = useState('');
  const [isColumnArrayOpen, setIsColumnArrayOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('lastTableSchema', schemaInput);
  }, [schemaInput]);

  const handleSchemaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newSchema = e.target.value;
    setSchemaInput(newSchema);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!schemaInput) {
      alert('Please enter a table schema first');
      return;
    }

    const schemaInfo = parseSchema(schemaInput);
    setColumnTypes(schemaInfo.columns);
    setExtractedTableName(schemaInfo.tableName);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      
      const parseCSV = (text: string): string[][] => {
        const result: string[][] = [];
        let row: string[] = [];
        let currentValue = '';
        let insideQuotes = false;
        
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          const nextChar = text[i + 1];
          
          if (char === '"' && !insideQuotes) {
            insideQuotes = true;
            continue;
          }
          
          if (char === '"' && insideQuotes) {
            if (nextChar === '"') {
              currentValue += '"';
              i++; // Skip the next quote
            } else {
              insideQuotes = false;
            }
            continue;
          }
          
          if (char === ',' && !insideQuotes) {
            // Trim the value when adding to row
            row.push(currentValue.trim());
            currentValue = '';
            continue;
          }
          
          if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') {
              i++; // Skip the next newline character for Windows-style line endings
            }
            // Trim the value when adding to row
            if (currentValue.trim()) {
              row.push(currentValue.trim());
            }
            if (row.length > 0) {
              result.push(row);
              row = [];
            }
            currentValue = '';
            continue;
          }
          
          currentValue += char;
        }
        
        // Handle the last value and row with trimming
        if (currentValue.trim()) {
          row.push(currentValue.trim());
        }
        if (row.length > 0) {
          result.push(row);
        }
        
        return result;
      };
      
      const lines = parseCSV(text);
      
      if (lines.length < 2) {
        alert('CSV file must have at least a header row and one data row');
        return;
      }

      try {
        const headers = lines[0].map(h => h.trim());
        const usedSlugs = new Map<string, number>();
        
        // Create a map of header to column type
        // First try exact match, then case-insensitive match
        const columnTypeMap = new Map<string, ColumnType>();
        
        for (const header of headers) {
          // Try exact match first
          const exactMatch = schemaInfo.columns.find(col => col.name === header);
          if (exactMatch) {
            columnTypeMap.set(header, exactMatch.type);
            continue;
          }
          
          // Try case-insensitive match
          const caseInsensitiveMatch = schemaInfo.columns.find(
            col => col.name.toLowerCase() === header.toLowerCase()
          );
          if (caseInsensitiveMatch) {
            columnTypeMap.set(header, caseInsensitiveMatch.type);
            continue;
          }
          
          // Default to string
          columnTypeMap.set(header, 'string');
        }
        
        // Check for timestamp columns by name pattern
        for (const header of headers) {
          if (header.endsWith('_at') && !columnTypeMap.has(header)) {
            columnTypeMap.set(header, 'timestamp');
          }
        }
        
        const values = lines.slice(1).map(line => 
          line.map((val, index) => {
            const header = headers[index];
            const type = columnTypeMap.get(header) || 'string';
            
            // Pass header name and usedSlugs map to formatValue
            const result = formatValue(val, type, header, usedSlugs);
            console.log(`Header: ${header}, Value: "${val}", Type: ${type}, Result: ${result}`);
            return result;
          })
        );

        const quotedHeaders = headers.map(h => quoteIdentifier(h));
        const tableName = schemaInfo.tableName || 'table_name';
        const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${quotedHeaders.join(', ')})\nVALUES\n` +
          values.map(row => `(${row.join(', ')})`).join(',\n') + ';';

        setSqlOutput(sql);
      } catch (error) {
        console.error('Error processing CSV:', error);
        alert('Error processing CSV file');
      }
    };
    reader.readAsText(file);
  };

  const handleCopyClick = useCallback(() => {
    if (sqlOutput) {
      navigator.clipboard.writeText(sqlOutput)
        .then(() => {
          toast({
            title: "Copied!",
            description: "SQL copied to clipboard",
            duration: 3000,
          });
        })
        .catch(err => {
          console.error('Failed to copy: ', err);
          toast({
            title: "Error",
            description: "Failed to copy SQL to clipboard",
            duration: 3000,
            variant: "destructive",
          });
        });
    }
  }, [sqlOutput]);

  return (
    <div className="p-6 min-h-screen flex">
      {/* Left Column */}
      <div className="flex-1 pr-6">
        <h1 className="text-3xl font-bold mb-6">CSV TO SQL INSERT TOOL</h1>
        
        <div className="space-y-6">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Table Schema
            </label>
            <Textarea
              placeholder="Enter table schema (CREATE TABLE statement)"
              value={schemaInput}
              onChange={handleSchemaChange}
              className="font-mono"
              rows={10}
            />
            {extractedTableName && (
              <p className="mt-2 text-sm text-green-600">
                Extracted table name: <span className="font-mono font-bold">{extractedTableName}</span>
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              Data
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Right Column */}
      <Separator orientation="vertical" className="mx-6" />
      <div className="flex-1 pl-6">
        {columnTypes.length > 0 && (
          <Collapsible
            open={isColumnArrayOpen}
            onOpenChange={setIsColumnArrayOpen}
            className="mb-6"
          >
            <div className="flex items-center space-x-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="p-0 w-8 h-8">
                  <ChevronRight className={`h-4 w-4 transform transition-transform ${isColumnArrayOpen ? 'rotate-90' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <label className="text-sm font-medium">
                Extracted Column Array
              </label>
            </div>
            
            <CollapsibleContent>
              <div className="mt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column Name</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {columnTypes.map((col, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-mono">{col.name}</TableCell>
                        <TableCell className="text-blue-600">{col.type}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div>
          <div className="flex justify-between items-center mb-4">
            <label className="text-sm font-medium">SQL Insert</label>
            {sqlOutput && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyClick}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy SQL
              </Button>
            )}
          </div>
          
          {sqlOutput && (
            <Textarea
              value={sqlOutput}
              readOnly
              className="font-mono min-h-[200px]"
              rows={10}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default CsvToSql;
