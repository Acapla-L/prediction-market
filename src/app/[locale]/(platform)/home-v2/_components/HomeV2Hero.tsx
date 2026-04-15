'use client'

import type { Event } from '@/types'
import useEmblaCarousel from 'embla-carousel-react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import HomeV2HeroSlide from '@/app/[locale]/(platform)/home-v2/_components/HomeV2HeroSlide'
import { Card } from '@/components/ui/card'

interface HomeV2HeroProps {
  events: Event[]
}

export default function HomeV2Hero({ events }: HomeV2HeroProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    align: 'start',
    skipSnaps: false,
  })
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!emblaApi) {
      return
    }
    function onSelect() {
      if (emblaApi) {
        setActiveIndex(emblaApi.selectedScrollSnap())
      }
    }
    onSelect()
    emblaApi.on('select', onSelect)
    return () => {
      emblaApi.off('select', onSelect)
    }
  }, [emblaApi])

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') {
        scrollPrev()
      }
      else if (event.key === 'ArrowRight') {
        scrollNext()
      }
    }
    const node = emblaApi?.rootNode()
    node?.addEventListener('keydown', onKeyDown)
    return () => {
      node?.removeEventListener('keydown', onKeyDown)
    }
  }, [emblaApi, scrollPrev, scrollNext])

  if (events.length === 0) {
    return (
      <Card className="flex h-96 items-center justify-center border-dashed p-6 text-sm text-muted-foreground">
        Featured markets unavailable
      </Card>
    )
  }

  return (
    <Card
      className="relative overflow-hidden p-4 lg:p-5"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured markets"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          Featured
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {activeIndex + 1}
            {' of '}
            {events.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={scrollPrev}
              aria-label="Previous slide"
              className="
                flex size-7 items-center justify-center rounded-full border border-border bg-card text-foreground
                transition-colors
                hover:bg-accent
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
              "
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <button
              type="button"
              onClick={scrollNext}
              aria-label="Next slide"
              className="
                flex size-7 items-center justify-center rounded-full border border-border bg-card text-foreground
                transition-colors
                hover:bg-accent
                focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
              "
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>

      <div ref={emblaRef} className="overflow-hidden" tabIndex={0}>
        <div className="flex">
          {events.map((event, index) => (
            <HomeV2HeroSlide
              key={event.id}
              event={event}
              isActive={index === activeIndex}
            />
          ))}
        </div>
      </div>
    </Card>
  )
}
