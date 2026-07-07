import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

interface Message {
  role: 'bot' | 'user' | 'error' | 'system'
  text: string
}

interface IntakeData {
  name: string
  dob: string
  phone: string
  email: string
  insurance_id: string
  payer: string
  copay: string
  department: string
  reason: string
  appointment_doctor: string
  appointment_date: string
  appointment_time: string
  guardian_name: string
  guardian_relationship: string
}

type Status = 'collecting' | 'complete' | 'emergency_redirect' | 'staff_requested' | 'ended'
type PayStatus = 'idle' | 'asking' | 'paying' | 'paid' | 'skipped'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const STEPS = [
  { id: 1, label: 'New or returning?', tag: 'Start'    },
  { id: 2, label: 'Identity check',    tag: 'Verify'   },
  { id: 3, label: 'Confirm details',   tag: 'Review'   },
  { id: 4, label: 'Insurance',         tag: 'Coverage' },
  { id: 5, label: 'Department',        tag: 'Route'    },
  { id: 6, label: 'Reason for visit',  tag: 'Note'     },
  { id: 7, label: 'Scheduling',        tag: 'Book'     },
  { id: 8, label: 'Confirmed',         tag: 'Done'     },
]

function inferStep(messages: Message[]): number {
  const bot = messages.filter(m => m.role === 'bot').map(m => m.text.toLowerCase()).join(' ')
  if (bot.includes("you're all set") || bot.includes('confirmed'))                   return 8
  if (bot.includes('available appointment') || bot.includes('dr.'))                  return 7
  if (bot.includes('coming in today') || bot.includes('why you'))                    return 6
  if (bot.includes('department') || bot.includes('family medicine'))                 return 5
  if (bot.includes('insurance') || bot.includes('copay'))                            return 4
  if (bot.includes('phone') && bot.includes('still correct'))                        return 3
  if (bot.includes('date of birth') || bot.includes('found a record'))               return 2
  return 1
}

function cleanBotMessage(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^\d+\./.test(line.trim()))
    .join('\n')
    .replace(/\s*Here are your options:\s*/gi, '')
    .replace(/\s*Which one works best for you\?\s*$/gi, '')
    .trim()
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email
  const [local, domain] = email.split('@')
  return `${local.slice(0, 3)}****@${domain}`
}

function formatDob(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function getQuickReplies(lastBotMsg: string): string[] {
  const msg = lastBotMsg.toLowerCase()
  if (msg.includes('new patient or a returning'))
    return ['New patient', 'Returning patient']
  if (msg.includes('is that still correct') || msg.includes('still current') ||
      msg.includes('still your current') || msg.includes('has that changed') ||
      msg.includes('is that right') || msg.includes('still active') ||
      msg.includes('ending in') || msg.includes('is that still'))
    return ['Yes', 'No, it changed']
  if (msg.includes('pay now or at the clinic'))
    return ['Pay now', 'Pay at clinic']
  if (msg.includes('which department') || msg.includes('family medicine')) {
    return [
      '1. Family Medicine', '2. OB/GYN', '3. Cardiology', '4. Urgent Care',
      '5. Mental Health', '6. Dermatology', '7. Pediatrics', '8. Other',
    ]
  }
  if (msg.includes('which one works best') || msg.includes('available appointment') || msg.includes('available slot')) {
    const lines = lastBotMsg.split('\n').filter(l => /^\d+\./.test(l.trim()))
    if (lines.length > 0) return lines.map(l => l.trim())
  }
  return []
}

function QuickReplies({ replies, onSelect }: { replies: string[]; onSelect: (r: string) => void }) {
  if (replies.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 0 6px', justifyContent: 'flex-start' }}>
      {replies.map(r => (
        <button key={r} onClick={() => onSelect(r)} style={{
          padding: '6px 14px', borderRadius: 20,
          border: '1.5px solid #8b5e52',
          background: 'transparent', color: '#8b5e52',
          fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          transition: 'all 0.15s', whiteSpace: 'nowrap',
          letterSpacing: '0.01em',
        }}
          onMouseEnter={e => {
            (e.target as HTMLButtonElement).style.background = '#8b5e52'
            ;(e.target as HTMLButtonElement).style.color = '#fff'
          }}
          onMouseLeave={e => {
            (e.target as HTMLButtonElement).style.background = 'transparent'
            ;(e.target as HTMLButtonElement).style.color = '#8b5e52'
          }}
        >{r}</button>
      ))}
    </div>
  )
}

function PaymentForm({ patientId, copay, patientName, doctor, date, onPaid, onSkip }: {
  patientId: string; copay: string; patientName: string; doctor: string; date: string
  onPaid: () => void; onSkip: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handlePay = async () => {
    if (!stripe || !elements) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/payment/create-intent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, amount_dollars: parseFloat(copay), patient_name: patientName, description: `Copay — ${doctor} ${date}` }),
      })
      const { client_secret, payment_intent_id } = await res.json()
      const card = elements.getElement(CardElement)
      if (!card) return
      const result = await stripe.confirmCardPayment(client_secret, { payment_method: { card } })
      if (result.error) {
        setError(result.error.message || 'Payment failed')
      } else if (result.paymentIntent?.status === 'succeeded') {
        await fetch(`${API}/payment/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, payment_intent_id }),
        })
        onPaid()
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #e8ddd6',
      borderRadius: 16, padding: '18px 20px', maxWidth: 360,
      alignSelf: 'flex-start', marginTop: 4,
      boxShadow: '0 1px 4px rgba(44,26,20,0.06)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#2c1a14', marginBottom: 2 }}>Pay copay — ${copay}</div>
      <div style={{ fontSize: 12, color: '#9e8880', marginBottom: 14 }}>{doctor} · {date}</div>
      <div style={{ border: '1px solid #e8ddd6', borderRadius: 8, padding: '10px 12px', background: '#faf7f3', marginBottom: 10 }}>
        <CardElement options={{ style: { base: { fontSize: '14px', color: '#2c1a14', fontFamily: 'Barlow, sans-serif' } } }} />
      </div>
      {error && <div style={{ fontSize: 12, color: '#b04030', marginBottom: 8 }}>{error}</div>}
      <button onClick={handlePay} disabled={loading} style={{
        width: '100%', padding: '9px', borderRadius: 8,
        background: loading ? '#c4a89e' : '#8b5e52', border: 'none', color: '#fff',
        fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', marginBottom: 6, letterSpacing: '0.02em',
      }}>{loading ? 'Processing...' : `Pay $${copay}`}</button>
      <button onClick={onSkip} disabled={loading} style={{
        width: '100%', padding: '9px', borderRadius: 8, background: 'transparent',
        border: '1px solid #e8ddd6', color: '#9e8880', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
      }}>Pay at the clinic</button>
      <div style={{ fontSize: 11, color: '#c4a89e', textAlign: 'center', marginTop: 8 }}>
        Test: 4242 4242 4242 4242 · any expiry · any CVC
      </div>
    </div>
  )
}

function ConsentForm({ patientName, onSigned }: { patientName: string; onSigned: (sig: string) => void }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [signed, setSigned] = useState(false)

  const suggestions = [
    { font: "'Dancing Script', cursive" },
    { font: "'Pacifico', cursive" },
    { font: "'Great Vibes', cursive" },
  ]

  const finalSig = selected !== null ? patientName : custom
  const selectedFont = selected !== null ? suggestions[selected].font : 'inherit'

  const handleSign = () => {
    if (!finalSig.trim()) return
    setSigned(true)
    onSigned(finalSig)
  }

  if (signed) return (
    <div style={{
      background: '#f5efe8', border: '1px solid #d4c4bc',
      borderRadius: 16, padding: '14px 18px', maxWidth: 360,
      alignSelf: 'flex-start', marginTop: 4,
    }}>
      <div style={{ fontSize: 13, color: '#6b3d30', fontWeight: 500 }}>Consent signed</div>
      <div style={{ fontSize: 11, color: '#9e8880', marginTop: 5 }}>
        Signed as: <em style={{ fontFamily: selectedFont, fontSize: 17, color: '#2c1a14' }}>{finalSig}</em>
      </div>
      <div style={{ fontSize: 11, color: '#9e8880', marginTop: 2 }}>
        {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  )

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Pacifico&family=Great+Vibes&display=swap" rel="stylesheet" />
      <div style={{
        background: '#fff', border: '1px solid #e8ddd6',
        borderRadius: 16, padding: '18px 20px', maxWidth: 360,
        alignSelf: 'flex-start', marginTop: 4,
        boxShadow: '0 1px 4px rgba(44,26,20,0.06)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#2c1a14', marginBottom: 4 }}>HIPAA Consent</div>
        <div style={{ fontSize: 11, color: '#9e8880', lineHeight: 1.6, marginBottom: 14, padding: '8px 10px', background: '#faf7f3', borderRadius: 8 }}>
          I authorize Ledelsea Health to use and disclose my protected health information for treatment, payment, and healthcare operations as described in the Notice of Privacy Practices.
        </div>
        <div style={{ fontSize: 11, color: '#6b3d30', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Choose a signature</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setSelected(i); setCustom('') }} style={{
              padding: '8px 14px', borderRadius: 8, textAlign: 'left',
              border: selected === i ? '1.5px solid #8b5e52' : '1px solid #e8ddd6',
              background: selected === i ? '#faf0ec' : '#faf7f3',
              cursor: 'pointer', fontFamily: s.font, fontSize: 22,
              color: '#2c1a14', transition: 'all 0.15s',
            }}>{patientName}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#9e8880', marginBottom: 5 }}>Or type your own</div>
        <input
          value={custom}
          onChange={e => { setCustom(e.target.value); setSelected(null) }}
          placeholder="Your full name"
          style={{
            width: '100%', padding: '9px 12px', borderRadius: 8,
            border: custom ? '1.5px solid #8b5e52' : '1px solid #e8ddd6',
            fontSize: 14, fontFamily: 'inherit', outline: 'none',
            boxSizing: 'border-box', marginBottom: 12, background: '#faf7f3',
          }}
        />
        {finalSig.trim() && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#faf7f3', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: '#9e8880', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Preview</div>
            <div style={{ fontFamily: selectedFont, fontSize: selected !== null ? 24 : 15, color: '#2c1a14' }}>{finalSig}</div>
          </div>
        )}
        <button onClick={handleSign} disabled={!finalSig.trim()} style={{
          width: '100%', padding: '9px', borderRadius: 8,
          background: !finalSig.trim() ? '#d4c4bc' : '#8b5e52',
          border: 'none', color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: !finalSig.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          letterSpacing: '0.02em',
        }}>I agree &amp; sign</button>
        <div style={{ fontSize: 10, color: '#c4a89e', textAlign: 'center', marginTop: 6 }}>
          By signing you agree to the HIPAA consent above
        </div>
      </div>
    </>
  )
}

function ConfirmationCard({ data, patientId, payStatus, stripePromise, onPaid, onSkip, onRestart }: {
  data: IntakeData; patientId: string | null; payStatus: PayStatus; stripePromise: any
  onPaid: () => void; onSkip: () => void; onRestart: () => void
}) {
  const Field = ({ label, value }: { label: string; value: string }) =>
    value ? (
      <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f0e8e0' }}>
        <span style={{ fontSize: 11, color: '#9e8880', minWidth: 100, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 1 }}>{label}</span>
        <span style={{ fontSize: 13, color: '#2c1a14', fontWeight: 500 }}>{value}</span>
      </div>
    ) : null

  const showCopay = data.copay && parseFloat(data.copay) > 0

  return (
    <div style={{
      background: '#fff', border: '1px solid #e8ddd6',
      borderRadius: 16, overflow: 'hidden',
      maxWidth: 360, width: '100%', alignSelf: 'flex-start', marginTop: 4,
      boxShadow: '0 2px 8px rgba(44,26,20,0.08)',
    }}>
      <div style={{ background: '#3d2b24', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 7L5 10.5L12.5 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: 2 }}>Intake complete</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>You&apos;re all set, {data.name?.split(' ')[0]}</div>
        </div>
      </div>

      {data.appointment_doctor && (
        <div style={{ background: '#f5ede6', padding: '12px 20px', borderBottom: '1px solid #e8ddd6' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8b5e52', marginBottom: 4 }}>Your appointment</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#3d2b24', fontFamily: "'Barlow', sans-serif" }}>{data.appointment_doctor}</div>
          <div style={{ fontSize: 12, color: '#6b4a40', marginTop: 2 }}>{data.appointment_date} · {data.appointment_time} · {data.department}</div>
        </div>
      )}

      <div style={{ padding: '4px 20px 12px' }}>
        <Field label="Patient"      value={data.name} />
        <Field label="DOB"          value={data.dob} />
        <Field label="Phone"        value={data.phone} />
        <Field label="Email"        value={maskEmail(data.email)} />
        <Field label="Insurance"    value={data.payer} />
        <Field label="Reason"       value={data.reason} />
        <Field label="Guardian"     value={data.guardian_name} />
        <Field label="Relationship" value={data.guardian_relationship} />
        {showCopay && (
          <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f0e8e0' }}>
            <span style={{ fontSize: 11, color: '#9e8880', minWidth: 100, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 1 }}>Copay</span>
            <span style={{ fontSize: 13, color: '#2c1a14', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              ${data.copay}
              {payStatus === 'paid' && <span style={{ fontSize: 10, background: '#f5ede6', color: '#8b5e52', padding: '2px 7px', borderRadius: 20 }}>Paid ✓</span>}
              {payStatus === 'skipped' && <span style={{ fontSize: 10, background: '#fdf4e8', color: '#a07030', padding: '2px 7px', borderRadius: 20 }}>Pay at clinic</span>}
            </span>
          </div>
        )}
      </div>

      {showCopay && payStatus === 'asking' && patientId && stripePromise && (
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{ fontSize: 12, color: '#6b4a40', marginBottom: 10 }}>
            Your copay is <strong>${data.copay}</strong>. Pay now or at the clinic?
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onPaid} style={{ padding: '7px 16px', borderRadius: 8, background: '#8b5e52', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Pay now</button>
            <button onClick={onSkip} style={{ padding: '7px 16px', borderRadius: 8, background: 'transparent', border: '1px solid #e8ddd6', color: '#9e8880', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Pay at clinic</button>
          </div>
        </div>
      )}

      <div style={{ padding: '10px 20px', borderTop: '1px solid #f0e8e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#faf7f3' }}>
        <span style={{ fontSize: 10, color: '#9e8880' }}>
          {payStatus === 'paid' ? 'Payment confirmed' : 'A reminder will be sent before your visit'}
        </span>
        <button onClick={onRestart} style={{ fontSize: 11, color: '#8b5e52', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          New intake
        </button>
      </div>
    </div>
  )
}

export default function IntakePage() {
  const [sessionId, setSessionId]           = useState<string | null>(null)
  const [messages, setMessages]             = useState<Message[]>([])
  const [input, setInput]                   = useState('')
  const [loading, setLoading]               = useState(false)
  const [status, setStatus]                 = useState<Status>('collecting')
  const [intakeData, setIntakeData]         = useState<IntakeData | null>(null)
  const [patientId, setPatientId]           = useState<string | null>(null)
  const [currentStep, setCurrentStep]       = useState(1)
  const [payStatus, setPayStatus]           = useState<PayStatus>('idle')
  const [showStripe, setShowStripe]         = useState(false)
  const [quickReplyUsed, setQuickReplyUsed] = useState(false)
  const [consentSigned, setConsentSigned]   = useState(false)
  const [stripePromise, setStripePromise]   = useState<any>(null)
  const messagesEndRef                      = useRef<HTMLDivElement>(null)
  const inputRef                            = useRef<HTMLInputElement>(null)
  const bootedRef                           = useRef(false)

  useEffect(() => {
    fetch(`${API}/payment/publishable-key`)
      .then(r => r.json())
      .then(d => { if (d.publishable_key) setStripePromise(loadStripe(d.publishable_key)) })
      .catch(() => {})
  }, [])

  const scroll = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  useEffect(() => { scroll() }, [messages, loading, showStripe, payStatus, consentSigned])

  const addMessage = (role: Message['role'], text: string) => {
    setMessages(prev => {
      const next = [...prev, { role, text }]
      setCurrentStep(inferStep(next))
      return next
    })
    if (role === 'bot') setQuickReplyUsed(false)
  }

  const boot = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`${API}/intake/start`, { method: 'POST' })
      const data = await res.json()
      setSessionId(data.session_id)
      addMessage('bot', data.message || 'Hi! Are you a new or returning patient?')
    } catch {
      addMessage('error', "Can't reach the backend. Make sure uvicorn is running on port 8000.")
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    boot()
  }, [boot])

  const sendText = async (text: string) => {
    if (!text || !sessionId || status !== 'collecting' || loading) return
    addMessage('user', text)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/intake/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      })
      const data = await res.json()
      const clean = (s: string) => (s || '').replace(/\*\*(.+?)\*\*/g, '$1')

      if (data.status === 'complete') {
        addMessage('bot', clean(data.reply))
        setStatus('complete')
        if (data.data) setIntakeData(data.data)
        if (data.patient_id) setPatientId(data.patient_id)
        const copay = data.data?.copay
        if (data.payment === 'now' && copay && parseFloat(copay) > 0) {
          setPayStatus('paying'); setShowStripe(true)
        } else if (copay && parseFloat(copay) > 0) {
          setPayStatus('asking')
        } else {
          setPayStatus('skipped')
        }
      } else if (data.status === 'emergency_redirect') {
        addMessage('error', clean(data.reply)); setStatus('emergency_redirect'); setCurrentStep(8)
      } else if (data.status === 'staff_requested') {
        addMessage('bot', clean(data.reply)); setStatus('staff_requested')
      } else if (data.status === 'ended') {
        setStatus('ended')
      } else {
        addMessage('bot', clean(data.reply) || 'Something went wrong.')
      }
    } catch {
      addMessage('error', 'Error reaching the server.')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleSend = () => sendText(input.trim())

  const handleQuickReply = (reply: string) => {
    const toSend = reply.replace(/^\d+\.\s*/, '')
    setQuickReplyUsed(true)
    sendText(toSend)
  }

  const restart = () => {
    setSessionId(null); setMessages([]); setInput('')
    setStatus('collecting'); setIntakeData(null); setPatientId(null)
    setCurrentStep(1); setPayStatus('idle'); setShowStripe(false)
    setQuickReplyUsed(false); setConsentSigned(false)
    bootedRef.current = false
    boot()
  }

  const lastBotMsg = [...messages].reverse().find(m => m.role === 'bot')?.text || ''
  const quickReplies = status === 'collecting' && !loading && !quickReplyUsed
    ? getQuickReplies(lastBotMsg) : []

  const isDobQuestion = status === 'collecting' && !loading && (
    lastBotMsg.toLowerCase().includes('date of birth') ||
    lastBotMsg.toLowerCase().includes('mm/dd/yyyy')
  )

  const locked = status !== 'collecting'
  const placeholderText = locked
    ? status === 'emergency_redirect' ? 'Please call 911 or 988 immediately.'
    : status === 'complete'           ? 'Intake complete — tap New intake to start again.'
    : 'Session ended.'
    : isDobQuestion                   ? 'MM / DD / YYYY'
    : quickReplies.length > 0         ? 'Or type your response...'
    : 'Type a message...'

  const showConsent = status === 'complete' && intakeData &&
    (payStatus === 'paid' || payStatus === 'skipped') && !consentSigned

  return (
    <>
      <Head>
        <title>Patient Intake —