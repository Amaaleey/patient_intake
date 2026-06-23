import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'

// ── Types ──────────────────────────────────────────────────────────────────
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
}

type Status = 'collecting' | 'complete' | 'emergency_redirect' | 'staff_requested' | 'ended'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ── Step inference ─────────────────────────────────────────────────────────
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
  if (bot.includes("you're all set") || bot.includes('confirmed'))                      return 8
  if (bot.includes('available appointment') || bot.includes('dr.'))                    return 7
  if (bot.includes('coming in today') || bot.includes('why you'))                      return 6
  if (bot.includes('department') || bot.includes('family medicine'))                   return 5
  if (bot.includes('insurance') || bot.includes('copay'))                              return 4
  if (bot.includes('phone') && bot.includes('still correct'))                          return 3
  if (bot.includes('date of birth') || bot.includes('found a record'))                 return 2
  return 1
}

// ── Main component ─────────────────────────────────────────────────────────
export default function IntakePage() {
  const [sessionId, setSessionId]     = useState<string | null>(null)
  const [messages, setMessages]       = useState<Message[]>([])
  const [input, setInput]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [status, setStatus]           = useState<Status>('collecting')
  const [intakeData, setIntakeData]   = useState<IntakeData | null>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const messagesEndRef                = useRef<HTMLDivElement>(null)
  const inputRef                      = useRef<HTMLInputElement>(null)
  const bootedRef                     = useRef(false)

  const scroll = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  useEffect(() => { scroll() }, [messages, loading])

  const addMessage = (role: Message['role'], text: string) => {
    setMessages(prev => {
      const next = [...prev, { role, text }]
      setCurrentStep(inferStep(next))
      return next
    })
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

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !sessionId || status !== 'collecting' || loading) return

    addMessage('user', text)
    setInput('')
    setLoading(true)

    try {
      const res  = await fetch(`${API}/intake/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      })
      const raw  = await res.text()
      const data = JSON.parse(raw)

      const clean = (s: string) => (s || '').replace(/\*\*(.+?)\*\*/g, '$1')

      if (data.status === 'complete') {
        addMessage('bot', clean(data.reply))
        setStatus('complete')
        if (data.data) setIntakeData(data.data)
      } else if (data.status === 'emergency_redirect') {
        addMessage('error', clean(data.reply))
        setStatus('emergency_redirect')
        setCurrentStep(8)
      } else if (data.status === 'staff_requested') {
        addMessage('bot', clean(data.reply))
        setStatus('staff_requested')
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

  const restart = () => {
    setSessionId(null)
    setMessages([])
    setInput('')
    setStatus('collecting')
    setIntakeData(null)
    setCurrentStep(1)
    boot()
  }

  const locked = status !== 'collecting'
  const placeholderText = locked
    ? status === 'emergency_redirect' ? 'Please call 911 or 988 immediately.'
    : status === 'complete'           ? 'Intake complete — click Start over to begin again.'
    : 'Session ended.'
    : 'Type a message...'

  return (
    <>
      <Head>
        <title>Patient Intake — AI Platform</title>
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Instrument Sans', sans-serif" }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: '272px',
          background: '#1a1916',
          display: 'flex',
          flexDirection: 'column',
          padding: '32px 24px 28px',
          flexShrink: 0,
          overflowY: 'auto',
        }}>
          {/* Brand */}
          <div style={{ marginBottom: '36px' }}>
            <div style={{ fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8a8880', marginBottom: '8px' }}>
              AI Intake Platform
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: '20px', color: '#fff', lineHeight: 1.2, fontWeight: 300 }}>
              Patient <em style={{ fontStyle: 'italic', color: '#9fb8ac' }}>Intake</em>
            </div>
          </div>

          {/* Step label */}
          <div style={{ fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8a8880', marginBottom: '12px' }}>
            Journey steps
          </div>

          {/* Steps */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
            {STEPS.map(step => {
              const isDone   = step.id < currentStep
              const isActive = step.id === currentStep
              return (
                <div key={step.id} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 12px', borderRadius: '8px',
                  background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}>
                  {/* Dot */}
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                    border: `1.5px solid ${isDone ? '#1a9e75' : isActive ? '#9fb8ac' : '#444'}`,
                    background: isDone ? '#1a9e75' : isActive ? 'rgba(159,184,172,0.15)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}>
                    {isDone && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  {/* Label */}
                  <span style={{
                    fontSize: '13px', flex: 1, lineHeight: 1.3,
                    color: isActive ? '#fff' : isDone ? '#aaa' : '#555',
                    fontWeight: isActive ? 500 : 400,
                  }}>
                    {step.label}
                  </span>
                  {/* Tag */}
                  <span style={{
                    fontSize: '10px', padding: '2px 7px', borderRadius: '20px', flexShrink: 0,
                    background: isDone ? 'rgba(26,158,117,0.15)' : isActive ? 'rgba(159,184,172,0.15)' : 'rgba(255,255,255,0.06)',
                    color: isDone ? '#1a9e75' : isActive ? '#9fb8ac' : '#555',
                  }}>
                    {isDone ? 'Done' : step.tag}
                  </span>
                </div>
              )
            })}
          </nav>

          {/* Footer */}
          <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '0.5px solid #2a2a28', fontSize: '11px', color: '#444', lineHeight: 1.6 }}>
            Ledelsea · AI Patient Intake<br />
            HAPI FHIR · NIST IAL2<br />
            HIPAA compliant
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f8f6f1' }}>

          {/* Top bar */}
          <div style={{
            padding: '16px 28px', background: '#fff',
            borderBottom: '0.5px solid #e2ddd6',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1a1916' }}>Patient Registration</div>
              <div style={{ fontSize: '12px', color: '#8a8880', marginTop: '1px' }}>Powered by Ledelsea · Secure · HIPAA compliant</div>
            </div>
            <button onClick={restart} style={{
              fontSize: '12px', color: '#4a4845', background: 'none',
              border: '0.5px solid #e2ddd6', borderRadius: '8px',
              padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Start over
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '24px 28px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}

            {loading && <TypingIndicator />}

            {/* Confirmation card */}
            {status === 'complete' && intakeData && (
              <ConfirmationCard data={intakeData} onRestart={restart} />
            )}

            {/* Staff banner */}
            {status === 'staff_requested' && (
              <div style={{
                background: '#fdf0dc', border: '0.5px solid #f0c878',
                borderRadius: '10px', padding: '12px 16px',
                fontSize: '13px', color: '#b06a10',
                alignSelf: 'center', textAlign: 'center', maxWidth: '80%',
              }}>
                Please call the clinic directly to complete your registration.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '16px 28px', background: '#fff',
            borderTop: '0.5px solid #e2ddd6',
            display: 'flex', gap: '10px', flexShrink: 0,
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={placeholderText}
              disabled={locked || loading}
              style={{
                flex: 1, padding: '11px 16px',
                border: '1.5px solid #e2ddd6', borderRadius: '24px',
                fontSize: '14px', outline: 'none', fontFamily: 'inherit',
                background: locked ? '#f0ede5' : '#fff', color: '#1a1916',
              }}
            />
            <button
              onClick={handleSend}
              disabled={locked || loading || !input.trim()}
              style={{
                width: '42px', height: '42px', borderRadius: '50%',
                background: locked || !input.trim() ? '#e2ddd6' : '#0d6b52',
                border: 'none', cursor: locked || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'background 0.15s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </main>
      </div>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: Message }) {
  const isUser   = msg.role === 'user'
  const isError  = msg.role === 'error'

  if (isError) return (
    <div style={{
      background: '#fdeee8', border: '0.5px solid #e8b4a8',
      borderRadius: '10px', padding: '12px 16px',
      fontSize: '13px', color: '#c04020', lineHeight: 1.6,
      maxWidth: '88%', alignSelf: 'center', textAlign: 'center',
    }}>
      {msg.text}
    </div>
  )

  return (
    <div style={{ maxWidth: '72%', alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        padding: '11px 15px',
        borderRadius: isUser ? '16px 16px 3px 16px' : '16px 16px 16px 3px',
        background: isUser ? '#0d6b52' : '#fff',
        border: isUser ? 'none' : '0.5px solid #e2ddd6',
        fontSize: '14px', lineHeight: 1.55,
        color: isUser ? '#fff' : '#1a1916',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.text}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div style={{ alignSelf: 'flex-start' }}>
      <div style={{
        display: 'flex', gap: '5px', padding: '12px 16px',
        background: '#fff', border: '0.5px solid #e2ddd6',
        borderRadius: '16px 16px 16px 3px',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: '6px', height: '6px', borderRadius: '50%', background: '#8a8880',
            animation: `bounce 1.2s ${i * 0.2}s infinite ease-in-out`,
          }} />
        ))}
      </div>
      <style>{`@keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }`}</style>
    </div>
  )
}

function ConfirmationCard({ data, onRestart }: { data: IntakeData; onRestart: () => void }) {
  const Field = ({ label, value }: { label: string; value: string }) =>
    value ? (
      <div style={{ display: 'flex', gap: '12px', padding: '9px 0', borderBottom: '0.5px solid #e2ddd6' }}>
        <span style={{ fontSize: '12px', color: '#8a8880', minWidth: '110px' }}>{label}</span>
        <span style={{ fontSize: '13px', color: '#1a1916', fontWeight: 500 }}>{value}</span>
      </div>
    ) : null

  return (
    <div style={{
      background: '#fff', border: '0.5px solid #e2ddd6',
      borderRadius: '14px', overflow: 'hidden',
      maxWidth: '460px', width: '100%', alignSelf: 'flex-start',
      marginTop: '8px',
    }}>
      {/* Header */}
      <div style={{ background: '#0d6b52', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '34px', height: '34px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 7L5 10.5L12.5 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: '2px' }}>Intake complete</div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>You&apos;re all set, {data.name?.split(' ')[0]}</div>
        </div>
      </div>

      {/* Appointment */}
      {data.appointment_doctor && (
        <div style={{ background: '#e0f0ea', padding: '14px 22px', borderBottom: '0.5px solid #e2ddd6' }}>
          <div style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#0d6b52', marginBottom: '6px' }}>Your appointment</div>
          <div style={{ fontSize: '17px', fontWeight: 600, color: '#0d6b52', fontFamily: "'Fraunces', serif", fontStyle: 'italic' }}>
            {data.appointment_doctor}
          </div>
          <div style={{ fontSize: '13px', color: '#4a4845', marginTop: '3px' }}>
            {data.appointment_date} · {data.appointment_time} · {data.department}
          </div>
        </div>
      )}

      {/* Fields */}
      <div style={{ padding: '6px 22px 14px' }}>
        <Field label="Name"       value={data.name} />
        <Field label="Date of birth" value={data.dob} />
        <Field label="Phone"      value={data.phone} />
        <Field label="Email"      value={data.email} />
        <Field label="Insurance"  value={data.payer} />
        <Field label="Member ID"  value={data.insurance_id} />
        <Field label="Copay"      value={data.copay ? `$${data.copay}` : ''} />
        <Field label="Reason"     value={data.reason} />
      </div>

      {/* Footer */}
      <div style={{
        padding: '14px 22px', borderTop: '0.5px solid #e2ddd6',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: '11px', color: '#8a8880' }}>A reminder will be sent before your appointment</span>
        <button onClick={onRestart} style={{
          fontSize: '12px', color: '#0d6b52', background: 'none',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
        }}>
          Start new intake
        </button>
      </div>
    </div>
  )
}
