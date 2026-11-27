import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';

export default function NotFound() {
  const t = useT();
  return (
    <div className="card mt-10 py-16">
      <EmptyState icon={Compass} title={t('notFound.title')} description={t('notFound.description')} action={<Link to="/"><Button variant="subtle" size="sm">{t('notFound.back')}</Button></Link>} />
    </div>
  );
}
