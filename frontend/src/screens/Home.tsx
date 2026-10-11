import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="main">
      <section className="card">
        <h2>Planning du jour</h2>
        <p>Les réservations du jour s’afficheront ici.</p>
        <Link to="/reservations/nouvelle"><button className="btn btn-accent">Nouvelle réservation</button></Link>
      </section>
      <section className="card">
        <h2>Appels à traiter</h2>
        <p>Aucun appel en attente pour le moment.</p>
      </section>
    </div>
  );
}
