import { useEffect, useState } from 'react';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatches(mq.matches);
    mq.addEventListener('change', fn);
    fn();
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return matches;
}
