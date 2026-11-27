import { CheckCircle2, Clock, CloudOff, AlertTriangle } from 'lucide-react';
import { SyncState } from '../domain/types';

export function SyncStateBadge({ state }: { state: SyncState }) {
  if (state === 'COMMITTED') {
    return (
      <span className="badge badge-success">
        <CheckCircle2 size={12} aria-hidden="true" />
        Committed
      </span>
    );
  }
  if (state === 'LOCAL_SAVED') {
    return (
      <span className="badge badge-warn">
        <CloudOff size={12} aria-hidden="true" />
        Saved Locally
      </span>
    );
  }
  if (state === 'SYNCING') {
    return (
      <span className="badge badge-blue">
        <Clock size={12} aria-hidden="true" />
        Syncing
      </span>
    );
  }
  return (
    <span className="badge badge-danger">
      <AlertTriangle size={12} aria-hidden="true" />
      Sync Failed
    </span>
  );
}

export function PaymentStatusBadge({
  status,
}: {
  status: 'PAID' | 'PARTIAL' | 'PENDING' | 'RETURNED';
}) {
  if (status === 'PAID') return <span className="badge badge-success">Paid / Settled</span>;
  if (status === 'PARTIAL') return <span className="badge badge-warn">Partial</span>;
  if (status === 'RETURNED') return <span className="badge badge-neutral">Returned</span>;
  return <span className="badge badge-danger">Pending</span>;
}
