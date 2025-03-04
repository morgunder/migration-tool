// Simple toast notification system

interface ToastOptions {
  title?: string;
  description: string;
  duration?: number;
  variant?: 'default' | 'destructive' | 'success';
}

export function toast(options: ToastOptions) {
  const { title, description, duration = 3000, variant = 'default' } = options;
  
  // Create toast element
  const toastEl = document.createElement('div');
  toastEl.className = 'fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md px-4 py-3 shadow-lg transition-all duration-300 opacity-0 translate-y-2';
  
  // Apply variant styles
  if (variant === 'destructive') {
    toastEl.classList.add('bg-red-600', 'text-white');
  } else if (variant === 'success') {
    toastEl.classList.add('bg-green-600', 'text-white');
  } else {
    toastEl.classList.add('bg-gray-800', 'text-white');
  }
  
  // Create content
  const contentEl = document.createElement('div');
  contentEl.className = 'flex flex-col';
  
  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'font-medium';
    titleEl.textContent = title;
    contentEl.appendChild(titleEl);
  }
  
  const descriptionEl = document.createElement('div');
  descriptionEl.className = 'text-sm';
  descriptionEl.textContent = description;
  contentEl.appendChild(descriptionEl);
  
  toastEl.appendChild(contentEl);
  
  // Add to DOM
  document.body.appendChild(toastEl);
  
  // Animate in
  setTimeout(() => {
    toastEl.classList.remove('opacity-0', 'translate-y-2');
  }, 10);
  
  // Remove after duration
  setTimeout(() => {
    toastEl.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      document.body.removeChild(toastEl);
    }, 300);
  }, duration);
}
