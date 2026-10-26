import { ArrowDownLeft, ArrowUpRight, ChevronDown } from 'lucide-react';
import type { Analysis, Destination } from '../lib/types';

export default function AccessChanges({
  comparison,
  onInspect,
}: {
  comparison: Analysis[];
  onInspect: (place: Destination, time: number) => void;
}) {
  const morning = new Set(comparison[0].places.map((p) => p.place.id));
  const evening = new Set(comparison[1].places.map((p) => p.place.id));
  const groups = [
    {
      label: 'Reachable at 8 am only',
      time: 480,
      icon: ArrowDownLeft,
      places: comparison[0].places.filter((p) => !evening.has(p.place.id)),
    },
    {
      label: 'Reachable at 8 pm only',
      time: 1200,
      icon: ArrowUpRight,
      places: comparison[1].places.filter((p) => !morning.has(p.place.id)),
    },
  ];
  return (
    <div className="access-changes">
      {groups.map((group) => (
        <details key={group.time}>
          <summary>
            <group.icon size={15} />
            <span>{group.label}</span>
            <strong>{group.places.length}</strong>
            <ChevronDown size={14} />
          </summary>
          <div>
            {group.places.length ? (
              group.places.map(({ place }) => (
                <button key={place.id} onClick={() => onInspect(place, group.time)}>
                  {place.name}
                  <ArrowUpRight size={12} />
                </button>
              ))
            ) : (
              <p>No places are exclusive to this departure time.</p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
