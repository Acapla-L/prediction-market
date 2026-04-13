'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, BadgeCheck, Heart, Info, ShieldCheck, UserCheck } from 'lucide-react'
import AppLink from '@/components/AppLink'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'

const EXTERNAL_WAGERWIRE = 'https://www.wagerwire.com/'
const EXTERNAL_WAGERWIRE_MARKETPLACE = 'https://www.wagerwire.com/for-sale'
const EXTERNAL_BIRCHES = 'https://www.bircheshealth.com/wagerwire'
const EXTERNAL_GAMCARE = 'https://www.gamcare.org.uk'
const EXTERNAL_GAMBLING_THERAPY = 'https://www.gamblingtherapy.org'
const EXTERNAL_GIBRALTAR = 'https://www.gibraltar.gov.gi/finance-gaming-and-regulations/remote-gambling'
const EXTERNAL_GLI = 'https://gaminglabs.com/'

interface FooterLinkProps {
  href: string
  children: ReactNode
  external?: boolean
}

function FooterLink({ href, children, external = false }: FooterLinkProps) {
  const className = 'text-sm text-foreground/80 transition-colors hover:text-primary'
  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  return (
    <a href={href} className={className} {...externalProps}>
      {children}
    </a>
  )
}

type SocialName = 'x' | 'instagram' | 'linkedin' | 'youtube' | 'discord'

const SOCIAL_PATHS: Record<SocialName, string> = {
  x: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  instagram: 'M12 2.163c3.204 0 3.584.012 4.85.07 1.366.062 2.633.336 3.608 1.311.975.975 1.249 2.242 1.311 3.608.058 1.266.069 1.646.069 4.85s-.012 3.584-.07 4.85c-.062 1.366-.336 2.633-1.311 3.608-.975.975-2.242 1.249-3.608 1.311-1.266.058-1.646.069-4.85.069s-3.584-.012-4.85-.07c-1.366-.062-2.633-.336-3.608-1.311-.975-.975-1.249-2.242-1.311-3.608C2.175 15.747 2.163 15.367 2.163 12s.012-3.584.07-4.85c.062-1.366.336-2.633 1.311-3.608C4.519 2.567 5.786 2.293 7.152 2.231 8.418 2.173 8.798 2.163 12 2.163zm0 1.802c-3.142 0-3.504.011-4.737.068-1.014.046-1.566.215-1.93.357-.484.188-.83.413-1.193.776-.363.363-.588.709-.776 1.193-.142.364-.311.916-.357 1.93C2.95 8.522 2.939 8.884 2.939 12s.011 3.478.068 4.711c.046 1.014.215 1.566.357 1.93.188.484.413.83.776 1.193.363.363.709.588 1.193.776.364.142.916.311 1.93.357 1.233.057 1.595.068 4.737.068s3.504-.011 4.737-.068c1.014-.046 1.566-.215 1.93-.357.484-.188.83-.413 1.193-.776.363-.363.588-.709.776-1.193.142-.364.311-.916.357-1.93.057-1.233.068-1.595.068-4.711s-.011-3.478-.068-4.711c-.046-1.014-.215-1.566-.357-1.93a3.21 3.21 0 00-.776-1.193 3.21 3.21 0 00-1.193-.776c-.364-.142-.916-.311-1.93-.357C15.504 3.976 15.142 3.965 12 3.965zm0 3.064A4.971 4.971 0 1112 16.97a4.971 4.971 0 010-9.941zm0 8.196a3.225 3.225 0 100-6.45 3.225 3.225 0 000 6.45zm6.328-8.391a1.16 1.16 0 11-2.32 0 1.16 1.16 0 012.32 0z',
  linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  youtube: 'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  discord: 'M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.182 0-2.157-1.085-2.157-2.42 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.335-.956 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.335-.946 2.42-2.157 2.42z',
}

function SocialIcon({ name, label }: { name: SocialName, label: string }) {
  return (
    <a
      href="#"
      aria-label={label}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground transition-colors hover:text-primary"
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="size-5"
        aria-hidden="true"
      >
        <path d={SOCIAL_PATHS[name]} />
      </svg>
    </a>
  )
}

function ColumnHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

function SocialIcons() {
  return (
    <div className="flex items-center gap-4">
      <SocialIcon name="x" label="X (Twitter)" />
      <SocialIcon name="instagram" label="Instagram" />
      <SocialIcon name="linkedin" label="LinkedIn" />
      <SocialIcon name="youtube" label="YouTube" />
      <SocialIcon name="discord" label="Discord" />
    </div>
  )
}

/* ============================================================ */
/* VARIATION A — WagerWire Style                                */
/* ============================================================ */

export function FooterVariantA() {
  return (
    <footer className="hidden border-t border-border bg-background text-foreground lg:block">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
          {/* Brand block */}
          <div className="lg:col-span-2">
            <div className="font-logo text-2xl tracking-tight uppercase">
              <span className="font-bold">WIRE</span>
              <span className="font-light"> PREDICTIONS</span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Gibraltar-licensed prediction markets. The regulated venue for forecasting the future.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Get in touch:
              {' '}
              <a href="mailto:hello@wirepredictions.com" className="text-foreground hover:text-primary">
                hello@wirepredictions.com
              </a>
            </p>
            <div className="mt-6">
              <SocialIcons />
            </div>
          </div>

          {/* Platform */}
          <div>
            <ColumnHeading>Platform</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/">Markets</FooterLink></li>
              <li><FooterLink href="/sports">Sports</FooterLink></li>
              <li><FooterLink href="/leaderboard">Leaderboard</FooterLink></li>
              <li><FooterLink href="/portfolio">Portfolio</FooterLink></li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <ColumnHeading>Company</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/about">About</FooterLink></li>
              <li><FooterLink href="/how-it-works">How It Works</FooterLink></li>
              <li><FooterLink href={EXTERNAL_WAGERWIRE} external>WagerWire</FooterLink></li>
              <li><FooterLink href={EXTERNAL_WAGERWIRE_MARKETPLACE} external>Marketplace</FooterLink></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <ColumnHeading>Legal</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/tos">Terms of Service</FooterLink></li>
              <li><FooterLink href="/privacy">Privacy Policy</FooterLink></li>
              <li><FooterLink href="/responsible-gambling">Responsible Gaming</FooterLink></li>
              <li><FooterLink href={EXTERNAL_GIBRALTAR} external>Gibraltar Regulator</FooterLink></li>
            </ul>
          </div>
        </div>

        {/* Compliance strip */}
        <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-8">
          <a
            href={EXTERNAL_GIBRALTAR}
            target="_blank"
            rel="noopener noreferrer"
            className="
              rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground/90
              hover:border-primary hover:text-primary
            "
          >
            Regulated by the Gibraltar Gambling Commission
          </a>
          <a
            href={EXTERNAL_GLI}
            target="_blank"
            rel="noopener noreferrer"
            className="
              rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground/90
              hover:border-primary hover:text-primary
            "
          >
            GLI-33 Certified
          </a>
          <span className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground/90">
            18+
          </span>
          <p className="ml-auto text-xs text-muted-foreground">
            Gambling problem? Call
            {' '}
            <a
              href={EXTERNAL_GAMCARE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-primary"
            >
              GamCare
            </a>
            {' '}
            ·
            {' '}
            <a
              href={EXTERNAL_GAMBLING_THERAPY}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-primary"
            >
              Gambling Therapy
            </a>
            {' '}
            · 1-800-GAMBLER
          </p>
        </div>

        {/* Copyright bar */}
        <div className="
          mt-6 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground
          sm:flex-row sm:items-center
        "
        >
          <p>© 2026 Wire Industries, Inc. All rights reserved.</p>
          <p>
            Powered by
            {' '}
            <a
              href={EXTERNAL_WAGERWIRE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground hover:text-primary"
            >
              WagerWire
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}

/* ============================================================ */
/* VARIATION B — Kalshi / Regulatory Style                      */
/* ============================================================ */

export function FooterVariantB() {
  return (
    <footer className="hidden border-t border-border bg-background text-foreground lg:block">
      {/* Regulatory notice strip */}
      <div className="border-y border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-start gap-4 px-6 py-5">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-xs font-semibold tracking-wider text-primary uppercase">Regulatory Notice</p>
            <p className="mt-1 text-sm text-foreground/90">
              WirePredictions operates under Gibraltar Gambling Commission license [REF]. Prediction
              market contracts involve financial risk and may result in loss. Not available in
              restricted jurisdictions. 18+ only.
              {' '}
              <FooterLink href="/tos">Terms</FooterLink>
              {' · '}
              <FooterLink href="/responsible-gambling">Responsible Gambling</FooterLink>
              {' · '}
              <FooterLink href="/jurisdictions">Jurisdictions</FooterLink>
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* 4-column link grid */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <ColumnHeading>Markets</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/">All Markets</FooterLink></li>
              <li><FooterLink href="/sports">Sports</FooterLink></li>
              <li><FooterLink href="/(home)/new">New Listings</FooterLink></li>
              <li><FooterLink href="/leaderboard">Leaderboard</FooterLink></li>
              <li><FooterLink href="/activity">Activity</FooterLink></li>
            </ul>
          </div>

          <div>
            <ColumnHeading>Regulatory</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href={EXTERNAL_GIBRALTAR} external>Gibraltar License</FooterLink></li>
              <li><FooterLink href="/tos">Terms of Service</FooterLink></li>
              <li><FooterLink href="/privacy">Privacy Policy</FooterLink></li>
              <li><FooterLink href="/aml">AML Policy</FooterLink></li>
              <li><FooterLink href="/jurisdictions">Restricted Jurisdictions</FooterLink></li>
            </ul>
          </div>

          <div>
            <ColumnHeading>Responsible Trading</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/responsible-gambling">Responsible Gambling</FooterLink></li>
              <li><FooterLink href="/self-exclusion">Self-Exclusion</FooterLink></li>
              <li><FooterLink href="/deposit-limits">Deposit Limits</FooterLink></li>
              <li><FooterLink href={EXTERNAL_BIRCHES} external>Birches Health</FooterLink></li>
              <li><FooterLink href={EXTERNAL_GAMCARE} external>GamCare</FooterLink></li>
            </ul>
          </div>

          <div>
            <ColumnHeading>Company</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/about">About</FooterLink></li>
              <li><FooterLink href="/how-it-works">How It Works</FooterLink></li>
              <li><FooterLink href={EXTERNAL_WAGERWIRE} external>Powered by WagerWire</FooterLink></li>
              <li><FooterLink href="/press">Press</FooterLink></li>
              <li><FooterLink href="/contact">Contact</FooterLink></li>
            </ul>
          </div>
        </div>

        {/* Credential card row — 4 cards, no unsupported claims */}
        <div className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <ShieldCheck className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">Gibraltar Gambling Commission</p>
              <p className="text-xs text-muted-foreground">Licensed Operator</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <BadgeCheck className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">GLI-33 Certified</p>
              <p className="text-xs text-muted-foreground">Gaming Labs International</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <UserCheck className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">18+ Verified</p>
              <p className="text-xs text-muted-foreground">Age-Gated Access</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <Heart className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">Birches Health Partner</p>
              <p className="text-xs text-muted-foreground">Responsible Gambling Support</p>
            </div>
          </div>
        </div>

        {/* Fine print legal */}
        <div className="mt-12 border-t border-border pt-8">
          <div className="space-y-2 text-center text-xs/relaxed text-muted-foreground">
            <p>
              WirePredictions is operated by Wire Industries, Inc. and is licensed and regulated by
              the Gibraltar Gambling Commission. Trading prediction market contracts involves
              substantial risk and may not be suitable for every investor.
            </p>
            <p>
              Past performance is not indicative of future results. You should carefully consider
              whether trading is appropriate for you in light of your experience, objectives,
              financial resources, and other relevant circumstances.
            </p>
            <p>
              © 2026 Wire Industries, Inc. All rights reserved. Powered by
              {' '}
              <a
                href={EXTERNAL_WAGERWIRE}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:text-primary"
              >
                WagerWire
              </a>
              .
            </p>
          </div>
          <div className="mt-6 flex justify-center">
            <SocialIcons />
          </div>
        </div>
      </div>
    </footer>
  )
}

/* ============================================================ */
/* VARIATION C — Designer's Pick                                */
/* ============================================================ */

export function FooterVariantC() {
  return (
    <footer className="hidden border-t border-border bg-background text-foreground lg:block">
      <div className="mx-auto max-w-7xl px-6 py-16">
        {/* Hero row */}
        <div className="grid grid-cols-1 gap-8 border-b border-border pb-12 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-7 text-primary" />
              <h2 className="text-xl font-semibold text-primary">Regulated in Gibraltar</h2>
            </div>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              Licensed by the Gibraltar Gambling Commission — one of the world's most respected
              regulators for online gaming and prediction markets.
            </p>
          </div>
          <div className="lg:text-right">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Powered by
            </p>
            <a
              href={EXTERNAL_WAGERWIRE}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-2xl font-bold text-foreground hover:text-primary"
            >
              WagerWire
            </a>
            <p className="mt-2 text-sm text-muted-foreground">
              The prediction market arm of Wire Industries, Inc.
            </p>
          </div>
        </div>

        {/* Asymmetric grid */}
        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="font-logo text-2xl tracking-tight uppercase">
              <span className="font-bold">WIRE</span>
              <span className="font-light"> PREDICTIONS</span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Forecast the future on a regulated, transparent prediction market. Built for traders,
              accessible to everyone.
            </p>
            <div className="mt-6">
              <SocialIcons />
            </div>
          </div>

          <div className="lg:col-span-2">
            <ColumnHeading>Markets</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/">All</FooterLink></li>
              <li><FooterLink href="/sports">Sports</FooterLink></li>
              <li><FooterLink href="/leaderboard">Leaderboard</FooterLink></li>
            </ul>
          </div>

          <div className="lg:col-span-2">
            <ColumnHeading>Company</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/about">About</FooterLink></li>
              <li><FooterLink href="/how-it-works">How It Works</FooterLink></li>
              <li><FooterLink href={EXTERNAL_WAGERWIRE_MARKETPLACE} external>Marketplace</FooterLink></li>
            </ul>
          </div>

          <div className="lg:col-span-2">
            <ColumnHeading>Legal</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/tos">Terms</FooterLink></li>
              <li><FooterLink href="/privacy">Privacy</FooterLink></li>
              <li><FooterLink href="/aml">AML Policy</FooterLink></li>
            </ul>
          </div>

          <div className="lg:col-span-2">
            <ColumnHeading>Responsible Play</ColumnHeading>
            <ul className="space-y-2">
              <li><FooterLink href="/responsible-gambling">Overview</FooterLink></li>
              <li><FooterLink href={EXTERNAL_BIRCHES} external>Birches Health</FooterLink></li>
              <li><FooterLink href={EXTERNAL_GAMCARE} external>GamCare</FooterLink></li>
            </ul>
          </div>
        </div>

        {/* Inline trust badge strip */}
        <div className="
          mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-border pt-8 text-xs
          text-muted-foreground
        "
        >
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            Gibraltar Gambling Commission
          </span>
          <span className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-primary" />
            GLI-33 Certified
          </span>
          <span className="flex items-center gap-2">
            <UserCheck className="size-4 text-primary" />
            18+ Verified
          </span>
          <span className="flex items-center gap-2">
            <Heart className="size-4 text-primary" />
            Birches Health Partner
          </span>
        </div>

        {/* Copyright — primary-tinted hairline */}
        <div className="mt-8 border-t border-primary/30 pt-6 text-center text-xs text-muted-foreground">
          <p>
            © 2026 Wire Industries, Inc. · Gibraltar Gambling Commission License [REF]
          </p>
          <p className="mt-1">
            Gambling can be addictive. Play responsibly. 1-800-GAMBLER ·
            {' '}
            <a href={EXTERNAL_GAMCARE} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
              GamCare.org
            </a>
            {' '}
            ·
            {' '}
            <a href={EXTERNAL_GAMBLING_THERAPY} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
              GamblingTherapy.org
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}

/* ============================================================ */
/* FINAL FOOTER — default export                                */
/* ============================================================ */

const SOCIAL_LINKEDIN = 'https://www.linkedin.com/company/wagerwire'
const SOCIAL_X = 'https://x.com/wagerwire'
const SOCIAL_INSTAGRAM = 'https://www.instagram.com/wagerwirelive'
const SOCIAL_YOUTUBE = 'https://www.youtube.com/@WagerWire'

const EXTERNAL_WAGERWIRE_NEWSROOM = 'https://www.wagerwire.com/community/newsroom'
const EXTERNAL_WAGERWIRE_MAGAZINE = 'https://www.wagerwire.com/community/magazine'
const EXTERNAL_WAGERWIRE_COMMUNITY = 'https://www.wagerwire.com/community'

function FooterSocialLink({ href, name, label }: { href: string, name: SocialName, label: string }) {
  return (
    <a
      href={href}
      aria-label={label}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground transition-colors hover:text-primary"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden="true">
        <path d={SOCIAL_PATHS[name]} />
      </svg>
    </a>
  )
}

const FOOTER_LINK_CLASS = 'text-sm text-foreground/80 transition-colors hover:text-primary'

// All internal links use AppLink (next-intl locale-aware). Stub routes that don't
// exist yet are cast via `as never` so Next typed routes accept them; clicking
// them will hit a 404 until the target page is built — acceptable for demo state.
function StubAppLink({ href, children }: { href: string, children: ReactNode }) {
  return (
    <AppLink href={href as never} className={FOOTER_LINK_CLASS}>
      {children}
    </AppLink>
  )
}
export default function Footer() {
  const site = useSiteIdentity()

  return (
    <footer className="hidden border-t border-border bg-background text-foreground lg:block">
      <div className="mx-auto max-w-7xl px-6 py-16">
        {/* ===== Section 1: Main Grid ===== */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          {/* Brand block */}
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2 text-2xl">
              <SiteLogoIcon
                logoSvg={site.logoSvg}
                logoImageUrl={site.logoImageUrl}
                alt={`${site.name} logo`}
                className="size-[1em] text-current [&_svg]:size-[1em] [&_svg_*]:fill-current [&_svg_*]:stroke-current"
                imageClassName="size-[1em] object-contain"
                size={32}
              />
              <span className="font-logo tracking-tight uppercase">
                <span className="font-bold">Wire</span>
                <span className="font-light"> Predictions</span>
              </span>
            </div>
            <p className="mt-4 max-w-sm text-sm/relaxed text-muted-foreground">
              The prediction market platform by WagerWire. Trade on the outcomes of real-world events.
            </p>
            <div className="mt-6 flex items-center gap-5">
              <FooterSocialLink href={SOCIAL_LINKEDIN} name="linkedin" label="LinkedIn" />
              <FooterSocialLink href={SOCIAL_X} name="x" label="X" />
              <FooterSocialLink href={SOCIAL_INSTAGRAM} name="instagram" label="Instagram" />
              <FooterSocialLink href={SOCIAL_YOUTUBE} name="youtube" label="YouTube" />
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-10 md:grid-cols-4 lg:col-span-8">
            {/* Markets */}
            <div>
              <ColumnHeading>Markets</ColumnHeading>
              <ul className="space-y-3">
                <li><AppLink href="/" className={FOOTER_LINK_CLASS}>All Markets</AppLink></li>
                <li><AppLink href="/sports" className={FOOTER_LINK_CLASS}>Sports</AppLink></li>
                <li><AppLink href="/leaderboard" className={FOOTER_LINK_CLASS}>Leaderboard</AppLink></li>
                <li><AppLink href="/new" className={FOOTER_LINK_CLASS}>New Listings</AppLink></li>
                <li>
                  <a href={EXTERNAL_WAGERWIRE_MARKETPLACE} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK_CLASS}>
                    Bet Slips
                  </a>
                </li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <ColumnHeading>Company</ColumnHeading>
              <ul className="space-y-3">
                <li><StubAppLink href="/about">About</StubAppLink></li>
                <li>
                  <a href={EXTERNAL_WAGERWIRE_NEWSROOM} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK_CLASS}>
                    Press
                  </a>
                </li>
                <li>
                  <a href={EXTERNAL_WAGERWIRE_MAGAZINE} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK_CLASS}>
                    Email Magazine
                  </a>
                </li>
                <li>
                  <a href={EXTERNAL_WAGERWIRE_COMMUNITY} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK_CLASS}>
                    Community Media
                  </a>
                </li>
                <li>
                  <a href={EXTERNAL_WAGERWIRE} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK_CLASS}>
                    WagerWire
                  </a>
                </li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <ColumnHeading>Resources</ColumnHeading>
              <ul className="space-y-3">
                <li><AppLink href="/docs/users" className={FOOTER_LINK_CLASS}>Docs</AppLink></li>
                <li><AppLink href="/docs/api-reference" className={FOOTER_LINK_CLASS}>APIs</AppLink></li>
                <li><AppLink href="/docs/users/my-account/affiliate-program" className={FOOTER_LINK_CLASS}>Affiliate Program</AppLink></li>
                <li><AppLink href="/docs/users/help-support/contact-support" className={FOOTER_LINK_CLASS}>Help Center</AppLink></li>
                <li><StubAppLink href="/responsible-gambling">Responsible Trading</StubAppLink></li>
              </ul>
            </div>

            {/* Regulatory */}
            <div>
              <ColumnHeading>Regulatory</ColumnHeading>
              <ul className="space-y-3">
                <li><StubAppLink href="/terms">Terms of Service</StubAppLink></li>
                <li><StubAppLink href="/privacy">Privacy Policy</StubAppLink></li>
                <li><StubAppLink href="/market-integrity">Market Integrity</StubAppLink></li>
                <li><StubAppLink href="/restricted-jurisdictions">Restricted Jurisdictions</StubAppLink></li>
              </ul>
            </div>
          </div>
        </div>

        {/* ===== Section 2: Credential Cards ===== */}
        <div className="mt-14 grid grid-cols-1 gap-3 border-t border-border pt-10 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <Info className="size-6 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-xs font-semibold text-foreground">Platform Demo</p>
              <p className="text-xs text-muted-foreground">For regulatory review</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <BadgeCheck className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">GLI-33 Certified</p>
              <p className="text-xs text-muted-foreground">Gaming Labs International</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <UserCheck className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">18+ Verified</p>
              <p className="text-xs text-muted-foreground">Age-Gated Access</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
            <Heart className="size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold text-foreground">Responsible Gambling</p>
              <p className="text-xs text-muted-foreground">Birches Health · GamCare</p>
            </div>
          </div>
        </div>

        {/* ===== Section 3: Risk Disclaimer ===== */}
        <div className="mt-10 border-t border-border pt-10">
          <p className="mx-auto max-w-4xl text-center text-xs/relaxed text-muted-foreground">
            Trading on Wire Predictions involves risk and may not be appropriate for all. Members risk losing
            their cost to enter any transaction, including fees. You should carefully consider whether trading on
            Wire Predictions is appropriate for you in light of your investment experience and financial resources.
            Any trading decisions you make are solely your responsibility and at your own risk. Information is
            provided for convenience only on an &quot;AS IS&quot; basis. Past performance is not necessarily
            indicative of future results.
          </p>
        </div>

        {/* ===== Section 4: Copyright Bar ===== */}
        <div className="
          mt-10 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs
          text-muted-foreground
          sm:flex-row sm:items-center
        "
        >
          <p>© 2026 Wire Industries, Inc. All rights reserved.</p>
          <p>
            Powered by
            {' '}
            <a
              href={EXTERNAL_WAGERWIRE}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground transition-colors hover:text-primary"
            >
              WagerWire
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
