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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '4px 0 8px', alignSelf: 'flex-start', maxWidth: 460 }}>
      {replies.map(r => (
        <button key={r} onClick={() => onSelect(r)} style={{
          padding: '7px 14px', borderRadius: 20, border: '1px solid #0d6b52',
          background: 'transparent', color: '#0d6b52', fontSize: 13,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap',
        }}
          onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = '#0d6b52'; (e.target as HTMLButtonElement).style.color = '#fff' }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = 'transparent'; (e.target as HTMLButtonElement).style.color = '#0d6b52' }}
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
    <div style={{ background: '#fff', border: '0.5px solid #e2ddd6', borderRadius: 14, padding: '20px 22px', maxWidth: 420, alignSelf: 'flex-start', marginTop: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1916', marginBottom: 4 }}>Pay copay — ${copay}</div>
      <div style={{ fontSize: 12, color: '#8a8880', marginBottom: 16 }}>{doctor} · {date}</div>
      <div style={{ border: '1px solid #e2ddd6', borderRadius: 8, padding: '10px 14px', background: '#fafaf8', marginBottom: 12 }}>
        <CardElement options={{ style: { base: { fontSize: '14px', color: '#1a1916', fontFamily: 'Instrument Sans, sans-serif' } } }} />
      </div>
      {error && <div style={{ fontSize: 12, color: '#c04020', marginBottom: 10 }}>{error}</div>}
      <button onClick={handlePay} disabled={loading} style={{
        width: '100%', padding: '10px', borderRadius: 8,
        background: loading ? '#e2ddd6' : '#0d6b52', border: 'none', color: '#fff',
        fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginBottom: 8,
      }}>{loading ? 'Processing...' : `Pay $${copay}`}</button>
      <button onClick={onSkip} disabled={loading} style={{
        width: '100%', padding: '10px', borderRadius: 8, background: 'transparent',
        border: '0.5px solid #e2ddd6', color: '#8a8880', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
      }}>Pay later at the clinic</button>
      <div style={{ fontSize: 11, color: '#ccc', textAlign: 'center', marginTop: 8 }}>
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
    <div style={{ background: '#e0f0ea', border: '0.5px solid #9fd8c0', borderRadius: 12, padding: '16px 20px', maxWidth: 460, alignSelf: 'flex-start', marginTop: 8 }}>
      <div style={{ fontSize: 13, color: '#0d6b52', fontWeight: 500 }}>Consent signed</div>
      <div style={{ fontSize: 11, color: '#4a9e75', marginTop: 6 }}>
        Signed as: <em style={{ fontFamily: selectedFont, fontSize: 18 }}>{finalSig}</em>
      </div>
      <div style={{ fontSize: 11, color: '#4a9e75', marginTop: 2 }}>
        {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  )

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&family=Pacifico&family=Great+Vibes&display=swap" rel="stylesheet" />
      <div style={{ background: '#fff', border: '0.5px solid #e2ddd6', borderRadius: 14, padding: '20px 22px', maxWidth: 460, alignSelf: 'flex-start', marginTop: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1916', marginBottom: 4 }}>HIPAA Consent &amp; Authorization</div>
        <div style={{ fontSize: 12, color: '#8a8880', lineHeight: 1.6, marginBottom: 16, padding: '10px 12px', background: '#f8f6f1', borderRadius: 8 }}>
          I authorize Ledelsea Health to use and disclose my protected health information
          for treatment, payment, and healthcare operations as described in the Notice of
          Privacy Practices. I acknowledge receipt of the Notice of Privacy Practices.
        </div>
        <div style={{ fontSize: 12, color: '#4a4845', marginBottom: 10, fontWeight: 500 }}>Choose a signature style:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setSelected(i); setCustom('') }} style={{
              padding: '10px 16px', borderRadius: 8, textAlign: 'left',
              border: selected === i ? '1.5px solid #0d6b52' : '0.5px solid #e2ddd6',
              background: selected === i ? '#f0f9f5' : '#fafaf8',
              cursor: 'pointer', fontFamily: s.font, fontSize: 24, color: '#1a1916', transition: 'all 0.15s',
            }}>{patientName}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#8a8880', marginBottom: 6 }}>Or type your own:</div>
        <input
          value={custom}
          onChange={e => { setCustom(e.target.value); setSelected(null) }}
          placeholder="Type your full name"
          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: custom ? '1.5px solid #0d6b52' : '0.5px solid #e2ddd6', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 14 }}
        />
        {finalSig.trim() && (
          <div style={{ marginBottom: 14, padding: '10px 14px', background: '#f8f6f1', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#8a8880', marginBottom: 4 }}>Preview:</div>
            <div style={{ fontFamily: selectedFont, fontSize: selected !== null ? 26 : 16, color: '#1a1916' }}>{finalSig}</div>
          </div>
        )}
        <button onClick={handleSign} disabled={!finalSig.trim()} style={{
          width: '100%', padding: '10px', borderRadius: 8,
          background: !finalSig.trim() ? '#e2ddd6' : '#0d6b52',
          border: 'none', color: '#fff', fontSize: 14,
          cursor: !finalSig.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
        }}>I agree &amp; sign</button>
        <div style={{ fontSize: 11, color: '#aaa', textAlign: 'center', marginTop: 8 }}>By signing you agree to the HIPAA consent above</div>
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
      <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '0.5px solid #e2ddd6' }}>
        <span style={{ fontSize: 12, color: '#8a8880', minWidth: 110 }}>{label}</span>
        <span style={{ fontSize: 13, color: '#1a1916', fontWeight: 500 }}>{value}</span>
      </div>
    ) : null

  const showCopay = data.copay && parseFloat(data.copay) > 0

  return (
    <div style={{ background: '#fff', border: '0.5px solid #e2ddd6', borderRadius: 14, overflow: 'hidden', maxWidth: 460, width: '100%', alignSelf: 'flex-start', marginTop: 8 }}>
      <div style={{ background: '#0d6b52', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 7L5 10.5L12.5 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: 2 }}>Intake complete</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>You&apos;re all set, {data.name?.split(' ')[0]}</div>
        </div>
      </div>

      {data.appointment_doctor && (
        <div style={{ background: '#e0f0ea', padding: '14px 22px', borderBottom: '0.5px solid #e2ddd6' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#0d6b52', marginBottom: 6 }}>Your appointment</div>
          <div style={{ fontSize: 17, fontWeight: 600, color: '#0d6b52', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }}>{data.appointment_doctor}</div>
          <div style={{ fontSize: 13, color: '#4a4845', marginTop: 3 }}>{data.appointment_date} · {data.appointment_time} · {data.department}</div>
        </div>
      )}

      <div style={{ padding: '6px 22px 14px' }}>
        <Field label="Patient"      value={data.name} />
        <Field label="DOB"          value={data.dob} />
        <Field label="Phone"        value={data.phone} />
        <Field label="Email"        value={data.email} />
        <Field label="Insurance"    value={data.payer} />
        <Field label="Reason"       value={data.reason} />
        <Field label="Guardian"     value={data.guardian_name} />
        <Field label="Relationship" value={data.guardian_relationship} />
        {showCopay && (
          <div style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '0.5px solid #e2ddd6' }}>
            <span style={{ fontSize: 12, color: '#8a8880', minWidth: 110 }}>Copay</span>
            <span style={{ fontSize: 13, color: '#1a1916', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
              ${data.copay}
              {payStatus === 'paid' && <span style={{ fontSize: 11, background: '#e0f0ea', color: '#0d6b52', padding: '2px 8px', borderRadius: 20 }}>Paid ✓</span>}
              {payStatus === 'skipped' && <span style={{ fontSize: 11, background: '#fdf0dc', color: '#b06a10', padding: '2px 8px', borderRadius: 20 }}>Pay at clinic</span>}
            </span>
          </div>
        )}
      </div>

      {showCopay && payStatus === 'asking' && patientId && stripePromise && (
        <div style={{ padding: '0 22px 18px' }}>
          <div style={{ fontSize: 13, color: '#4a4845', marginBottom: 12 }}>
            Your copay is <strong>${data.copay}</strong>. Would you like to pay now or at the clinic?
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onPaid} style={{ padding: '8px 18px', borderRadius: 8, background: '#0d6b52', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Pay now</button>
            <button onClick={onSkip} style={{ padding: '8px 18px', borderRadius: 8, background: 'transparent', border: '0.5px solid #e2ddd6', color: '#8a8880', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Pay at clinic</button>
          </div>
        </div>
      )}

      <div style={{ padding: '14px 22px', borderTop: '0.5px solid #e2ddd6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#8a8880' }}>
          {payStatus === 'paid' ? 'Payment confirmed' : 'A reminder will be sent before your appointment'}
        </span>
        <button onClick={onRestart} style={{ fontSize: 12, color: '#0d6b52', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Start new intake</button>
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
    : status === 'complete'           ? 'Intake complete — click Start over to begin again.'
    : 'Session ended.'
    : isDobQuestion                   ? 'MM / DD / YYYY'
    : quickReplies.length > 0         ? 'Or type your response...'
    : 'Type a message...'

  const showConsent = status === 'complete' && intakeData &&
    (payStatus === 'paid' || payStatus === 'skipped') && !consentSigned

  return (
    <>
      <Head>
        <title>Patient Intake — AI Platform</title>
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Instrument Sans', sans-serif" }}>

        <aside style={{ width: 272, background: '#1a1916', display: 'flex', flexDirection: 'column', padding: '32px 24px 28px', flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ marginBottom: 36 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8a8880', marginBottom: 8 }}>AI Intake Platform</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, color: '#fff', lineHeight: 1.2, fontWeight: 300 }}>
              Patient <em style={{ fontStyle: 'italic', color: '#9fb8ac' }}>Intake</em>
            </div>
          </div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8a8880', marginBottom: 12 }}>Journey steps</div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
            {STEPS.map(step => {
              const isDone = step.id < currentStep
              const isActive = step.id === currentStep
              return (
                <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, border: `1.5px solid ${isDone ? '#1a9e75' : isActive ? '#9fb8ac' : '#444'}`, background: isDone ? '#1a9e75' : isActive ? 'rgba(159,184,172,0.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isDone && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <span style={{ fontSize: 13, flex: 1, color: isActive ? '#fff' : isDone ? '#aaa' : '#555', fontWeight: isActive ? 500 : 400 }}>{step.label}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, flexShrink: 0, background: isDone ? 'rgba(26,158,117,0.15)' : isActive ? 'rgba(159,184,172,0.15)' : 'rgba(255,255,255,0.06)', color: isDone ? '#1a9e75' : isActive ? '#9fb8ac' : '#555' }}>
                    {isDone ? 'Done' : step.tag}
                  </span>
                </div>
              )
            })}
          </nav>

          <a href="/portal" style={{ display: 'block', marginTop: 16, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #2a2a28', fontSize: 12, color: '#8a8880', textDecoration: 'none', textAlign: 'center' }}>
            View statements & pay →
          </a>
          <div style={{ marginTop: 16, paddingTop: 20, borderTop: '0.5px solid #2a2a28', fontSize: 11, color: '#444', lineHeight: 1.6 }}>
            Ledelsea · AI Patient Intake<br />HAPI FHIR · NIST IAL2<br />HIPAA compliant
          </div>
        </aside>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8f6f1' }}>
          <div style={{ padding: '16px 28px', background: '#fff', borderBottom: '0.5px solid #e2ddd6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1916' }}>Patient Registration</div>
              <div style={{ fontSize: 12, color: '#8a8880', marginTop: 1 }}>Powered by Ledelsea · Secure · HIPAA compliant</div>
            </div>
            <button onClick={restart} style={{ fontSize: 12, color: '#4a4845', background: 'none', border: '0.5px solid #e2ddd6', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>Start over</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((msg, i) => {
              const cleaned = msg.role === 'bot' ? cleanBotMessage(msg.text) : msg.text
              return <Bubble key={i} msg={{ ...msg, text: cleaned }} />
            })}
            {loading && <TypingIndicator />}

            {quickReplies.length > 0 && <QuickReplies replies={quickReplies} onSelect={handleQuickReply} />}

            {status === 'complete' && intakeData && (
              <>
                <ConfirmationCard
                  data={intakeData} patientId={patientId} payStatus={payStatus} stripePromise={stripePromise}
                  onPaid={() => { setPayStatus('paying'); setShowStripe(true) }}
                  onSkip={() => setPayStatus('skipped')}
                  onRestart={restart}
                />
                {(payStatus === 'paying' || showStripe) && patientId && stripePromise && intakeData.copay && (
                  <Elements stripe={stripePromise}>
                    <PaymentForm
                      patientId={patientId} copay={intakeData.copay} patientName={intakeData.name}
                      doctor={intakeData.appointment_doctor} date={intakeData.appointment_date}
                      onPaid={() => { setPayStatus('paid'); setShowStripe(false) }}
                      onSkip={() => { setPayStatus('skipped'); setShowStripe(false) }}
                    />
                  </Elements>
                )}
                {showConsent && (
                  <ConsentForm
                    patientName={intakeData.guardian_name || intakeData.name}
                    onSigned={(sig) => {
                      setConsentSigned(true)
                      console.log(`[consent] Signed as: ${sig} at ${new Date().toISOString()}`)
                    }}
                  />
                )}
                {consentSigned && (
                  <div style={{ background: '#f0f9f5', border: '0.5px solid #9fd8c0', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#0d6b52', maxWidth: 460, alignSelf: 'flex-start' }}>
                    Consent received. Your registration is complete — see you at your appointment.
                  </div>
                )}
              </>
            )}

            {status === 'staff_requested' && (
              <div style={{ background: '#fdf0dc', border: '0.5px solid #f0c878', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#b06a10', alignSelf: 'center', textAlign: 'center', maxWidth: '80%' }}>
                Please call the clinic directly to complete your registration.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div style={{ padding: '12px 28px 16px', background: '#fff', borderTop: '0.5px solid #e2ddd6', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => {
                  if (isDobQuestion) {
                    setInput(formatDob(e.target.value))
                  } else {
                    setInput(e.target.value)
                  }
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={placeholderText}
                disabled={locked || loading}
                style={{
                  flex: 1, padding: '11px 16px',
                  border: isDobQuestion ? '1.5px solid #0d6b52' : '1.5px solid #e2ddd6',
                  borderRadius: 24, fontSize: 14, outline: 'none', fontFamily: 'inherit',
                  background: locked ? '#f0ede5' : '#fff', color: '#1a1916',
                  letterSpacing: isDobQuestion ? '0.08em' : 'normal',
                }}
              />
              <button onClick={handleSend} disabled={locked || loading || !input.trim()} style={{
                width: 42, height: 42, borderRadius: '50%', background: locked || !input.trim() ? '#e2ddd6' : '#0d6b52',
                border: 'none', cursor: locked || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </main>
      </div>
    </>
  )
}

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const isError = msg.role === 'error'
  if (isError) return (
    <div style={{ background: '#fdeee8', border: '0.5px solid #e8b4a8', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#c04020', lineHeight: 1.6, maxWidth: '88%', alignSelf: 'center', textAlign: 'center' }}>{msg.text}</div>
  )
  return (
    <div style={{ maxWidth: '72%', alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ padding: '11px 15px', borderRadius: isUser ? '16px 16px 3px 16px' : '16px 16px 16px 3px', background: isUser ? '#0d6b52' : '#fff', border: isUser ? 'none' : '0.5px solid #e2ddd6', fontSize: 14, lineHeight: 1.55, color: isUser ? '#fff' : '#1a1916', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {msg.text}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div style={{ alignSelf: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 5, padding: '12px 16px', background: '#fff', border: '0.5px solid #e2ddd6', borderRadius: '16px 16px 16px 3px' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#8a8880', animation: `bounce 1.2s ${i * 0.2}s infinite ease-in-out` }} />
        ))}
      </div>
      <style>{`@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}`}</style>
    </div>
  )
}