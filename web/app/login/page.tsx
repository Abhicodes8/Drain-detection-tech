import type { Metadata } from 'next';
import AccountPanel from '../../components/account-panel';
import DesignAsset from '../../components/design-asset';
import styles from './page.module.css';

export const metadata: Metadata = { title: 'Sign in | Synk' };

export default function LoginPage() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="Synk home">
        <DesignAsset file="10c6a.svg" />
        Synk
      </a>
      <a className={styles.back} href="/">← Back to home</a>
    </header>
    <div className={styles.wrap}>
      <p className={styles.tagline}><strong>Catch the slow drain before it becomes a clog.</strong><br />
      Sign in to register your building&apos;s sinks and watch every drain.</p>
      <AccountPanel />
    </div>
  </main>;
}
