/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>Configura tu acceso a {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <div style={logoContainer}>
          <Img src="https://apfjafxiykkiydepmswk.supabase.co/storage/v1/object/public/email-assets/kawiil-logo.png" alt="Kawiil" width="56" height="56" style={logoImg} />
        </div>
        <Heading style={h1}>Configura tu acceso a Kawiil OS</Heading>
        <Text style={text}>
          Se ha creado una cuenta para ti en{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Haz clic en el botón para establecer tu contraseña y acceder a la plataforma.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Configurar mi contraseña
        </Button>
        <Text style={footer}>
          Si no esperabas este correo, puedes ignorarlo.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }
const container = { padding: '40px 25px' }
const logoContainer = { textAlign: 'center' as const, marginBottom: '24px' }
const logoImg = { display: 'inline-block' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#1a1f36',
  margin: '0 0 20px',
  textAlign: 'center' as const,
}
const text = {
  fontSize: '14px',
  color: '#6b7280',
  lineHeight: '1.6',
  margin: '0 0 25px',
}
const link = { color: '#4f46e5', textDecoration: 'underline' }
const button = {
  backgroundColor: '#4f46e5',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600' as const,
  borderRadius: '8px',
  padding: '14px 32px',
  textDecoration: 'none',
  display: 'block' as const,
  textAlign: 'center' as const,
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0', textAlign: 'center' as const }
