import { Spinner } from '@/components/ui/spinner';

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Spinner className="size-8 text-primary" ariaLabel="Loading / Laden" />
    </div>
  );
}