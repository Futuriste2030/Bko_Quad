export default function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <div className="main">
      <div className="card">
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </div>
  );
}
