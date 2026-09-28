import { Link } from "react-router-dom";
import AuthShell from "../components/AuthShell";
import PublicEmailForm from "../components/PublicEmailForm";

export default function Reenviar() {
  return (
    <AuthShell title="Reenviar confirmación">
      <PublicEmailForm operation="cuenta.reenviar_confirmacion" submitLabel="Reenviar el correo" />
      <p className="mt-4 text-sm"><Link className="text-primary underline" to="/ingresar">Volver a ingresar</Link></p>
    </AuthShell>
  );
}
