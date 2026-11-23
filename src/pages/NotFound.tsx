import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="card mt-10 py-16">
      <EmptyState icon={Compass} title="Page not found" description="This page doesn't exist." action={<Link to="/"><Button variant="subtle" size="sm">Back to overview</Button></Link>} />
    </div>
  );
}
