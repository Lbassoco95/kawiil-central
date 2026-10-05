import { Link, useParams } from "react-router-dom";
import AuthShell from "../components/AuthShell";
import LegalText, { useLegal } from "../components/LegalText";

const TITLES: Record<string, string> = {
  aviso_privacidad: "Aviso de privacidad",
  terminos: "Términos y condiciones",
  contrato_uso: "Contrato de uso",
};

export default function Legal() {
  const { kind = "aviso_privacidad" } = useParams();
  const doc = useLegal(TITLES[kind] ? kind : "aviso_privacidad");
  return (
    <AuthShell title={TITLES[kind] ?? "Aviso de privacidad"}>
      <LegalText doc={doc} />
      <p className="mt-4 text-sm"><Link className="text-primary underline" to="/ingresar">Volver</Link></p>
    </AuthShell>
  );
}
