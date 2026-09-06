import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Loader2Icon } from 'lucide-react';

function Spinner({
  className,
  ariaLabel = 'Loading',
  ...props
}: ComponentProps<'svg'> & { ariaLabel?: string }) {
  return (
    <Loader2Icon
      role="status"
      aria-label={ariaLabel}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
