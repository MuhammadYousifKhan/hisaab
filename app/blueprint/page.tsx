import type { Metadata } from 'next';
import { BLUEPRINT_HTML } from '@/lib/content/blueprint';

export const metadata: Metadata = { title: 'Blueprint' };

export default function BlueprintPage() {
  return (
    <>
      <div className="aud"><span className="aud-k">Written for</span><p><b>Team Aceva.</b> What the challenge asks, who we’re building for, the architecture, ledger rules and data model.</p></div>
      {/* Static content authored by the team; no user input is rendered here. */}
      <div dangerouslySetInnerHTML={{ __html: BLUEPRINT_HTML }} />
    </>
  );
}
