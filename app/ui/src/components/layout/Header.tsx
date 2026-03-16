import { useAppStore } from '../../stores/app';

interface HeaderProps {
  title: string;
  subtitle: string;
}

export default function Header({ title, subtitle }: HeaderProps) {
  const { appInfo } = useAppStore();

  return (
    <section className="hero glass hero-compact">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="hero-side">
        <div className="hero-chip">
          <span>流程来源</span>
          <strong>{appInfo.workflow_source}</strong>
        </div>
        <div className="hero-chip">
          <span>当前版本</span>
          <strong>{appInfo.version}</strong>
        </div>
      </div>
    </section>
  );
}
