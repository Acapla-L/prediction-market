import { Inter, Raleway } from 'next/font/google'

export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
})

export const raleway = Raleway({
  subsets: ['latin'],
  weight: ['300', '700'],
  display: 'swap',
  variable: '--font-logo',
})
