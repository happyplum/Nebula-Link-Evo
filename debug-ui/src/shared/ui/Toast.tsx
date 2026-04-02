import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './Toast.module.css';

export interface ToastProps {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  onClose?: () => void;
}

export function Toast({ type, message, duration = 5000, onClose }: ToastProps) {
  useEffect(() => {
    if (duration <= 0) return;
    
    const timer = setTimeout(() => {
      onClose?.();
    }, duration);
    
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className={`${styles.toast} ${styles[type]}`} data-testid={`toast-${type}`}>
      <p className={styles.message}>{message}</p>
      <button 
        type="button"
        className={styles.closeButton} 
        onClick={onClose}
        aria-label="Close toast"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <title>Close</title>
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );
}

// Simple global state for toasts
let toastIdCounter = 0;
type ToastItem = ToastProps & { id: number };
let listeners: ((toasts: ToastItem[]) => void)[] = [];
let currentToasts: ToastItem[] = [];

const notifyListeners = () => {
  listeners.forEach(listener => {
    listener([...currentToasts]);
  });
};

export const toastManager = {
  add: (props: Omit<ToastProps, 'onClose'>) => {
    const id = ++toastIdCounter;
    const newToast = { ...props, id };
    currentToasts = [...currentToasts, newToast];
    notifyListeners();
    return id;
  },
  remove: (id: number) => {
    currentToasts = currentToasts.filter(t => t.id !== id);
    notifyListeners();
  }
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (newToasts: ToastItem[]) => setToasts(newToasts);
    listeners.push(listener);
    setToasts([...currentToasts]);
    
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className={styles.container}>
      {toasts.map(toast => (
        <Toast 
          key={toast.id} 
          {...toast} 
          onClose={() => {
            toast.onClose?.();
            toastManager.remove(toast.id);
          }} 
        />
      ))}
    </div>,
    document.body
  );
}

export function useToast() {
  const toast = useCallback((props: Omit<ToastProps, 'onClose'>) => {
    toastManager.add(props);
  }, []);

  return { toast };
}
