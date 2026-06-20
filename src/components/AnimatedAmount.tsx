import { useState, useEffect, useRef } from 'react';
import { fmt } from '../lib/helpers';

export const AnimatedAmount = ({ value, className = '' }: { value: number; className?: string }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(value);

  useEffect(() => {
    const startValue = prevValueRef.current;
    const diff = value - startValue;
    if (diff === 0) {
      setDisplayValue(value);
      return;
    }

    const duration = 600; // 600ms
    const startTime = performance.now();

    let animationId: number;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // ease-out-cubic function
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + diff * eased);
      
      setDisplayValue(current);

      if (progress < 1) {
        animationId = requestAnimationFrame(tick);
      } else {
        prevValueRef.current = value;
        setDisplayValue(value);
      }
    };

    animationId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [value]);

  return <span className={className} style={{ fontFamily: 'JetBrains Mono' }}>{fmt(displayValue)}</span>;
};
