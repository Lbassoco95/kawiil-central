import { Link } from "react-router-dom";
import AuthShell from "../components/AuthShell";
import PublicEmailForm from "../components/PublicEmailForm";

export default function Recuperar() {
  return (
    <AuthShell title="Recuperar contraseña">
      <PublicEmailForm operation="cuenta.recuperar" submitLabel="Enviar enlace" />
      <p className="mt-4 text-sm"><Link className="text-primary underline" to="/ingresar">Volver a ingresar</Link></p>
    </AuthShell>
  );
}
