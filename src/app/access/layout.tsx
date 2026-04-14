import type { ReactNode } from 'react'
import { inter, raleway } from '@/lib/fonts'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

interface Props {
  children: ReactNode
}

export default async function AccessLayout({ children }: Props) {
  const runtimeTheme = await loadRuntimeThemeState()

  return (
    <html
      lang="en"
      className={`${inter.variable} ${raleway.variable}`}
      data-theme-preset={runtimeTheme.theme.presetId}
      data-theme-mode="dark"
      suppressHydrationWarning
    >
      <body className="bg-background font-sans text-foreground antialiased">
        {runtimeTheme.theme.cssText && (
          <style id="theme-vars" dangerouslySetInnerHTML={{ __html: runtimeTheme.theme.cssText }} />
        )}
        {children}
      </body>
    </html>
  )
}
