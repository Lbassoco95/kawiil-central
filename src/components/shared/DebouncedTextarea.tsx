import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Textarea } from "@/components/ui/textarea";

interface DebouncedTextareaProps {
  value: string;
  onChange: (value: string) => void;
  delay?: number;
  className?: string;
  placeholder?: string;
}

/**
 * Textarea with fully local state that only propagates changes
 * to the parent after a debounce delay. Prevents re-render lag
 * when the parent re-renders frequently (e.g. timers, list state).
 */
export const DebouncedTextarea = memo(function DebouncedTextarea({
  value,
  onChange,
  delay = 400,
  className,
  placeholder,
}: DebouncedTextareaProps) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // Sync from parent only when not actively typing
  useEffect(() => {
    if (!isTypingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newVal = e.target.value;
      isTypingRef.current = true;
      setLocalValue(newVal);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        isTypingRef.current = false;
        onChange(newVal);
      }, delay);
    },
    [onChange, delay]
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <Textarea
      className={className}
      placeholder={placeholder}
      value={localValue}
      onChange={handleChange}
    />
  );
});
