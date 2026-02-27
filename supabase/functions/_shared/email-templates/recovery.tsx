/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Restablece tu contraseña de {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <div style={logoContainer}>
          <div style={logoBox}>
            <span style={logoText}>K</span>
          </div>
        </div>
        <Heading style={h1}>Restablecer contraseña</Heading>
        <Text style={text}>
          Recibimos una solicitud para restablecer tu contraseña en {siteName}.
          Haz clic en el botón para elegir una nueva contraseña.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Restablecer contraseña
        </Button>
        <Text style={footer}>
          Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña no será modificada.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }
const container = { padding: '40px 25px' }
const logoContainer = { textAlign: 'center' as const, marginBottom: '24px' }
const logoBox = {
  display: 'inline-block',
  width: '48px',
  height: '48px',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, hsl(239, 84%, 67%) 0%, hsl(271, 81%, 56%) 100%)',
  textAlign: 'center' as const,
  lineHeight: '48px',
}
const logoText = { color: '#ffffff', fontSize: '20px', fontWeight: 'bold' as const }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: 'hsl(224, 30%, 14%)',
  margin: '0 0 20px',
  textAlign: 'center' as const,
}
const text = {
  fontSize: '14px',
  color: 'hsl(220, 10%, 46%)',
  lineHeight: '1.6',
  margin: '0 0 25px',
}
const button = {
  backgroundColor: 'hsl(239, 84%, 67%)',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  borderRadius: '8px',
  padding: '12px 24px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'center' as const }
