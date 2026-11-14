'use client';

import { useState } from 'react';
import { supabase, useSession } from '../lib/supabase';
import styles from './account-panel.module.css';

type Mode = 'signup' | 'signin' | 'confirm' | 'forgot';

export default function AccountPanel({recovery=false}:{recovery?:boolean}) {
  const session = useSession();
  const [mode, setMode] = useState<Mode>('signup');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeatSignup, setRepeatSignup] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');

  if (!supabase) return <section className={styles.card}><p className={styles.help}>Sign-in is temporarily unavailable. Please try again later or contact your installer.</p></section>;
  const auth = supabase.auth;
  const clear = () => { setError(''); setNotice(''); };
  const toDashboard = () => { window.location.assign('/dashboard'); };

  if (recovery) return <section className={styles.card} aria-label="Reset password">
    <h1 className={styles.title}>Set a new password</h1>
    {session ? <form className={styles.form} onSubmit={async e => {
      e.preventDefault(); clear();
      if (newPassword !== repeatPassword) { setError('The passwords do not match.'); return; }
      setBusy(true);
      try { const { error } = await auth.updateUser({ password: newPassword }); if (error) setError(error.message); else setNotice('Password updated. You can return to your dashboard.'); }
      catch { setError('Could not update your password. Try again.'); } finally { setBusy(false); }
    }}>
      <label className={styles.field}>New password<input type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
      <label className={styles.field}>Repeat new password<input type="password" autoComplete="new-password" required minLength={8} value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} /></label>
      <button className={styles.primary} disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
    </form> : <p className={styles.help}>Open the password reset link in your email. If it has expired, request a new one from the sign-in page.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <a className={styles.link} href="/login">Back to sign in</a>
  </section>;

  if (!session) {
    if (mode === 'confirm') return <section className={styles.card} aria-label="Confirm your email">
      <div className={styles.mailBadge} aria-hidden="true">✉</div>
      <h2 className={styles.title}>Check your email</h2>
      <p className={styles.help}>We sent a confirmation link to <strong>{email}</strong>. Open it, then come back and log in.</p>
      <button className={styles.secondary} disabled={busy} onClick={async () => {
        clear(); setBusy(true);
        try { const { error } = await auth.resend({ type: 'signup', email }); if (error) setError(error.message); else setNotice('Confirmation email sent again.'); }
        catch { setError('Could not resend the email. Try again.'); } finally { setBusy(false); }
      }}>Resend email</button>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <button className={styles.link} type="button" onClick={() => { clear(); setMode('signin'); }}>I&apos;ve confirmed — log in</button>
    </section>;

    if (mode === 'forgot') return <section className={styles.card} aria-label="Reset your password">
      <h2 className={styles.title}>Reset your password</h2>
      <p className={styles.help}>Enter your account email and we&apos;ll send you a reset link.</p>
      <form className={styles.form} onSubmit={async e => {
        e.preventDefault(); clear(); setBusy(true);
        try { const { error } = await auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' }); if (error) setError(error.message); else setNotice('If an account uses this email, a reset link is on its way.'); }
        catch { setError('Could not request a reset link. Try again.'); } finally { setBusy(false); }
      }}>
        <label className={styles.field}>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <button className={styles.primary} disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <button className={styles.link} type="button" onClick={() => { clear(); setMode('signin'); }}>Back to log in</button>
    </section>;

    return <section className={styles.card} aria-label="Account">
      <div className={styles.tabs} role="tablist" aria-label="Sign up or log in">
        <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? styles.tabActive : styles.tab} onClick={() => { clear(); setMode('signup'); }}>Create account</button>
        <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? styles.tabActive : styles.tab} onClick={() => { clear(); setMode('signin'); }}>Log in</button>
      </div>

      {mode === 'signup' ? <form className={styles.form} onSubmit={async e => {
        e.preventDefault(); clear();
        if (!company.trim()) { setError('Enter your company name.'); return; }
        if (password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
        if (password !== repeatSignup) { setError('The passwords do not match.'); return; }
        setBusy(true);
        try {
          const { data, error } = await auth.signUp({ email, password, options: { data: { company_name: company.trim() }, emailRedirectTo: window.location.origin + '/login' } });
          if (error) setError(error.message);
          else if (data.session) toDashboard();
          else setMode('confirm');
        } catch { setError('Could not create your account. Try again.'); } finally { setBusy(false); }
      }}>
        <label className={styles.field}>Company name<input type="text" autoComplete="organization" placeholder="Lakeside Hotels" required value={company} onChange={e => setCompany(e.target.value)} /></label>
        <label className={styles.field}>Work email<input type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <div className={styles.row}>
          <label className={styles.field}>Password<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label className={styles.field}>Repeat password<input type="password" autoComplete="new-password" required minLength={8} value={repeatSignup} onChange={e => setRepeatSignup(e.target.value)} /></label>
        </div>
        <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create company account'}</button>
        <p className={styles.fineprint}>At least 8 characters. You&apos;ll confirm your email before the first login.</p>
      </form> : <form className={styles.form} onSubmit={async e => {
        e.preventDefault(); clear(); setBusy(true);
        try { const { error } = await auth.signInWithPassword({ email, password }); if (error) setError(error.message); else toDashboard(); }
        catch { setError('Could not sign in. Check your connection and try again.'); } finally { setBusy(false); }
      }}>
        <label className={styles.field}>Email<input type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className={styles.field}>Password<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <button className={styles.link} type="button" onClick={() => { clear(); setMode('forgot'); }}>Forgot password?</button>
      </form>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>;
  }

  const companyName = typeof session.user.user_metadata?.company_name === 'string' ? session.user.user_metadata.company_name : '';
  if (!companyName) return <section className={styles.card} aria-label="Company details">
    <h2 className={styles.title}>One last step</h2>
    <p className={styles.help}>Tell us which company this account is for.</p>
    <form className={styles.form} onSubmit={async e => {
      e.preventDefault(); clear();
      if (!company.trim()) { setError('Enter your company name.'); return; }
      setBusy(true);
      try { const { error } = await auth.updateUser({ data: { company_name: company.trim() } }); if (error) setError(error.message); else toDashboard(); }
      catch { setError('Could not save your company name. Try again.'); } finally { setBusy(false); }
    }}>
      <label className={styles.field}>Company name<input type="text" autoComplete="organization" placeholder="Lakeside Hotels" required value={company} onChange={e => setCompany(e.target.value)} /></label>
      <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
    </form>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.fineprint}>Signed in as {session.user.email}. <button className={styles.link} type="button" onClick={() => { void auth.signOut(); }}>Sign out</button></p>
  </section>;

  return <section className={styles.card} aria-label="Account">
    <h2 className={styles.title}>{companyName}</h2>
    <p className={styles.help}>Signed in as {session.user.email}.</p>
    <div className={styles.actions}>
      <a className={styles.primary} href="/dashboard">Open dashboard</a>
      <a className={styles.secondary} href="/add-unit">Set up a unit</a>
      <button className={styles.secondary} type="button" onClick={() => { void auth.signOut(); }}>Sign out</button>
    </div>
  </section>;
}
