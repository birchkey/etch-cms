import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { contentTypesApi, ContentType } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, FileText, Pencil, Trash2, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePageTitle } from '@/lib/settings';

export default function ContentTypeList() {
  usePageTitle('Collections');
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    contentTypesApi.list()
      .then(setContentTypes)
      .catch(() => toast.error('Failed to load content types'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (ct: ContentType) => {
    if (!confirm(`Delete "${ct.name}"? This will delete all entries too.`)) return;
    setDeleting(ct.id);
    try {
      await contentTypesApi.delete(ct.id);
      setContentTypes(prev => prev.filter(c => c.id !== ct.id));
      toast.success('Deleted');
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Collections</h1>
          <p className="text-zinc-500 text-sm mt-1">Define your content structure.</p>
        </div>
        <Link to="/content-types/new">
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Collection
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      ) : contentTypes.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-zinc-200">
          <FileText className="h-12 w-12 text-zinc-300 mx-auto mb-4" />
          <p className="text-zinc-600 font-medium">No collections yet</p>
          <p className="text-zinc-400 text-sm mt-1 mb-6">Create your first collection to get started.</p>
          <Link to="/content-types/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Collection
            </Button>
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 divide-y divide-zinc-100">
          {contentTypes.map(ct => (
            <div key={ct.id} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 transition-colors group">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-zinc-900">{ct.name}</p>
                <p className="text-xs text-zinc-400 font-mono">{ct.slug}</p>
                {ct.description && (
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">{ct.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <Link to={`/content-types/${ct.id}`}>
                  <Button variant="ghost" size="icon" title="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete"
                  onClick={() => handleDelete(ct)}
                  disabled={deleting === ct.id}
                >
                  {deleting === ct.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4 text-red-400" />
                  }
                </Button>
              </div>
              <Link to={`/content-types/${ct.id}/entries`} title="View entries">
                <Button variant="ghost" size="icon">
                  <ArrowRight className="h-4 w-4 text-zinc-400" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
