import { Link } from "react-router-dom";
import { PRIVACY_NOTICE_UPDATED_LABEL, PRIVACY_CONTACT_EMAIL } from "@/lib/privacyNotice";

/** Aviso de Privacidad Integral — reclutamiento. Público (sin sesión). */
export default function AvisoPrivacidad() {
  const mail = (
    <a className="underline" href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>
  );
  const h = "mt-8 mb-2 text-base font-semibold text-gray-900";
  const li = "ml-5 list-disc";
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white px-4 py-3">
        <img src="/images/kawiil-logo.png" alt="Kawiil" className="h-8 w-auto"
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
      </nav>
      <main className="mx-auto max-w-[720px] px-4 py-8 text-sm leading-relaxed text-gray-700">
        <h1 className="text-2xl font-bold text-gray-900">Aviso de Privacidad Integral</h1>
        <p className="mt-1 text-gray-500">Módulo de Reclutamiento</p>
        <p className="mt-1 text-xs text-gray-500">Fecha de última actualización: {PRIVACY_NOTICE_UPDATED_LABEL}</p>

        <h2 className={h}>I. Identidad y domicilio del Responsable</h2>
        <p>Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C. (en adelante, &ldquo;K&apos;awiil&rdquo;), con domicilio en Tuxpan 63 Int. 402, Col. Roma Sur, Alcaldía Cuauhtémoc, C.P. 06760, Ciudad de México, como Responsable en términos de la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.</p>

        <h2 className={h}>II. Datos personales que recabamos</h2>
        <p>En el proceso de reclutamiento y selección, K&apos;awiil recaba las siguientes categorías de datos personales:</p>
        <ul className="mt-2 space-y-1">
          <li className={li}><strong>Datos de identificación y contacto:</strong> nombre completo, correo electrónico, número de teléfono y, en su caso, domicilio.</li>
          <li className={li}><strong>Datos académicos y profesionales:</strong> trayectoria laboral, historial académico, certificaciones, habilidades y cualquier información contenida en el currículum que el candidato decida compartir.</li>
          <li className={li}><strong>Datos de referencias:</strong> nombre e información de contacto de personas que el candidato proporcione como referencias profesionales o académicas.</li>
        </ul>
        <p className="mt-2">No recabamos datos personales sensibles en el proceso de postulación. En caso de que en etapas posteriores del proceso se requieran datos de esta naturaleza (p. ej., constancia de antecedentes no penales), se informará al candidato mediante un aviso específico y se obtendrá su consentimiento expreso.</p>

        <h2 className={h}>III. Finalidades del tratamiento</h2>
        <p><strong>Finalidades primarias</strong> (necesarias para la relación entre K&apos;awiil y el candidato):</p>
        <ul className="mt-2 space-y-1">
          <li className={li}>Evaluar la candidatura para el puesto al que se postula.</li>
          <li className={li}>Gestionar y dar seguimiento a las etapas del proceso de selección.</li>
          <li className={li}>Contactar al candidato durante el proceso.</li>
          <li className={li}>Verificar referencias profesionales y académicas.</li>
        </ul>
        <p className="mt-3"><strong>Finalidades secundarias</strong> (no necesarias para la selección, sujetas a consentimiento expreso):</p>
        <ul className="mt-2 space-y-1">
          <li className={li}>Conservar los datos del candidato en la base de talentos de K&apos;awiil para ser considerado en vacantes futuras.</li>
          <li className={li}>Enviar comunicaciones informativas sobre K&apos;awiil, vacantes disponibles o actividades de la organización.</li>
        </ul>
        <p className="mt-2">Puedes oponerte a las finalidades secundarias en cualquier momento mediante el procedimiento descrito en la sección VI.</p>

        <h2 className={h}>IV. Transferencias de datos personales</h2>
        <p>K&apos;awiil no realiza transferencias de tus datos personales a terceros sin tu consentimiento, salvo en los supuestos previstos en el artículo 37 de la LFPDPPP (obligaciones legales, orden judicial u otras causas equivalentes).</p>
        <p className="mt-2">En caso de que K&apos;awiil recurra a proveedores de servicios de tecnología para alojar o gestionar el proceso de reclutamiento (encargados del tratamiento), dichos proveedores únicamente tratarán tus datos bajo las instrucciones de K&apos;awiil y en los términos del contrato correspondiente.</p>

        <h2 className={h}>V. Mecanismos para limitar el uso o divulgación de tus datos</h2>
        <p>Puedes inscribirte en el Registro Público para Evitar Publicidad (REPEP) ante la PROFECO para limitar el uso de tus datos con fines publicitarios. Asimismo, puedes solicitar directamente a K&apos;awiil la limitación del tratamiento de tus datos escribiendo a {mail}.</p>

        <h2 className={h}>VI. Derechos ARCO</h2>
        <p>Tienes derecho a Acceder a tus datos personales en posesión de K&apos;awiil, a Rectificarlos cuando sean inexactos o incompletos, a Cancelarlos cuando consideres que no son necesarios para las finalidades que motivaron su recolección, y a Oponerte a su tratamiento.</p>
        <p className="mt-2"><strong>¿Cómo ejercerlos?</strong> Envía una solicitud a {mail} con la siguiente información:</p>
        <ul className="mt-2 space-y-1">
          <li className={li}>Nombre completo e identificación oficial (imagen).</li>
          <li className={li}>Descripción clara del derecho que deseas ejercer y los datos a los que se refiere.</li>
          <li className={li}>Cualquier documento que facilite la localización de tus datos.</li>
        </ul>
        <p className="mt-2">K&apos;awiil responderá en un plazo máximo de 20 días hábiles a partir de la recepción de la solicitud. Ese plazo puede prorrogarse por 20 días hábiles adicionales, previa notificación. La efectividad de la resolución tendrá lugar dentro de los 15 días hábiles siguientes a la respuesta favorable.</p>
        <p className="mt-2">Si consideras que tus derechos no fueron atendidos, puedes presentar una queja ante el Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales (INAI), en <a className="underline" href="https://www.inai.org.mx" target="_blank" rel="noopener noreferrer">www.inai.org.mx</a>.</p>

        <h2 className={h}>VII. Modificaciones al aviso de privacidad</h2>
        <p>K&apos;awiil se reserva el derecho de modificar este aviso en cualquier momento. Cualquier cambio se notificará a través de la plataforma Kawiil Central y/o mediante correo electrónico a los candidatos activos. El aviso actualizado estará disponible permanentemente en esta misma página.</p>

        <h2 className={h}>VIII. Consentimiento</h2>
        <p>El tratamiento de tus datos para las finalidades primarias se sustenta en el consentimiento que otorgas al marcar el checkbox obligatorio del formulario de postulación, y en la relación jurídica precontractual que genera tu candidatura.</p>
        <p className="mt-2">El tratamiento para finalidades secundarias requiere tu consentimiento expreso, el cual se recaba mediante el checkbox opcional en el mismo formulario.</p>

        <p className="mt-10 text-xs text-gray-400">
          <Link to="/login" className="underline">Kawiil Central</Link>
        </p>
      </main>
    </div>
  );
}
