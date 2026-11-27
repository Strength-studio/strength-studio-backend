import { OnboardingFlow } from '../onboarding-flow';
export const metadata = { title: 'Client setup | Strength Studio', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';
export default function Page() { return <OnboardingFlow step="setup" />; }
