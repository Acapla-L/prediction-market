import type { ReactNode } from 'react'
import { inter, raleway } from '@/lib/fonts'

interface Props {
  children: ReactNode
}

export default function AccessLayout({ children }: Props) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${raleway.variable}`}
      data-theme-mode="dark"
    >
      <body className="bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}
