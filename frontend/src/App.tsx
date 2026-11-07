/**
 * Andamio mínimo: comprueba la sesión y la conexión con el API.
 * Las pantallas reales (catálogo, subida, equipo) van después.
 */

import { Route, Routes } from 'react-router-dom'
import AuthCallback from './routes/AuthCallback'
import Home from './routes/Home'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
    </Routes>
  )
}
