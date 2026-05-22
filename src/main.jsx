import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './one_piece_card_finder.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
