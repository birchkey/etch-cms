import { Badge } from './ui/badge';

export function StatusBadge({ status, hasChanges }: { status: 'draft' | 'published' | 'scheduled'; hasChanges?: boolean }) {
  if (status === 'published' && hasChanges) return <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50">Has Changes</Badge>;
  if (status === 'published') return <Badge variant="success">Published</Badge>;
  if (status === 'scheduled') return <Badge className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50">Scheduled</Badge>;
  return <Badge variant="secondary">Draft</Badge>;
}
