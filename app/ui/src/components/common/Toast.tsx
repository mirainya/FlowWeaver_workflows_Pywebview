import { useAppStore } from '../../stores/app';

export default function Toast() {
  const { toast } = useAppStore();

  if (!toast.visible) return null;

  return (
    <div className={`toast-banner ${toast.tone}`}>
      {toast.message}
    </div>
  );
}
