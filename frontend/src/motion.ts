import { useEffect, useLayoutEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { heroScroll } from "./heroScroll";

const REVEAL = "[data-reveal], .page-heading, .panel, .table-scroll, .msg, .summary li, .specs > div, .band-head, .budget-tile, .brand-grid a, .category-grid a, .method > div, .card";

export function usePageMotion(scope: RefObject<HTMLElement>, route: string) {
  useEffect(() => {
    if (!scope.current || typeof IntersectionObserver === "undefined" || typeof window.matchMedia !== "function") return;
    const root = scope.current;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const context = gsap.context(() => {}, root);
      context.add(() => gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: .5, ease: "power2.out", clearProps: "opacity" }));
      const seen = new WeakSet<Element>();
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }, index) => {
          if (!isIntersecting) return;
          observer.unobserve(target);
          context.add(() => gsap.fromTo(target,
            { opacity: 0, y: 26, filter: "blur(6px)" },
            { opacity: 1, y: 0, filter: "blur(0px)", duration: .85, delay: Math.min(index, 4) * .055, ease: "power3.out", clearProps: "transform,opacity,filter" }));
        });
      }, { threshold: 0.06, rootMargin: "0px 0px -6% 0px" });
      const collect = () => root.querySelectorAll(REVEAL).forEach((node) => {
        if (!seen.has(node)) { seen.add(node); observer.observe(node); }
      });
      collect();
      const mutations = new MutationObserver(collect);
      mutations.observe(root, { childList: true, subtree: true });
      const revealFocus = (event: FocusEvent) => {
        const node = (event.target as HTMLElement).closest<HTMLElement>(REVEAL);
        if (node) { observer.unobserve(node); gsap.killTweensOf(node); gsap.set(node, { clearProps: "transform,opacity,filter" }); }
      };
      root.addEventListener("focusin", revealFocus);
      return () => { observer.disconnect(); mutations.disconnect(); root.removeEventListener("focusin", revealFocus); context.revert(); };
    });
    return () => media.revert();
  }, [scope, route]);
}

export function useHeroMotion(scope: RefObject<HTMLElement>, vehicle: number) {
  // The opening: the stage settles, then the headline rises out of its mask.
  useLayoutEffect(() => {
    if (!scope.current || typeof window.matchMedia !== "function") return;
    const root = scope.current;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const context = gsap.context(() => {
        gsap.timeline({ defaults: { ease: "expo.out" } })
          .fromTo(".cinema-stage", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 1.9, ease: "power2.out" }, 0)
          .fromTo(".hero-copy .eyebrow", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .9 }, .25)
          .fromTo(".hero-line > span", { yPercent: 115, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.3, stagger: .1 }, .32)
          .fromTo(".hero-description > span, .hero-actions", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1, stagger: .09, clearProps: "transform" }, .68)
          .fromTo(".cinema-rail > *", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .9, stagger: .06, clearProps: "transform" }, .85);
      }, root);
      return () => context.revert();
    });
    return () => media.revert();
  }, [scope]);

  // The film. Rebuilt whenever the showroom vehicle changes, so its caption joins the timeline.
  useLayoutEffect(() => {
    if (!scope.current || typeof window.matchMedia !== "function") return;
    let disposed = false;
    const root = scope.current;
    const media = gsap.matchMedia();
    import("gsap/ScrollTrigger").then(({ ScrollTrigger }) => {
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);
      media.add("(min-width: 1000px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)", () => {
        const context = gsap.context(() => {
          const film = gsap.timeline({
            scrollTrigger: { trigger: root, start: "top top", end: "bottom bottom", scrub: .8, invalidateOnRefresh: true, onUpdate: (self) => heroScroll.set(self.progress) },
          });
          // Each chapter arrives from depth and is left behind as the camera carries on through it.
          const chapter = (index: string, enter: number, exit?: number) => {
            const node = `.chapter[data-chapter='${index}']`;
            gsap.set(node, { opacity: 0, z: -320, filter: "blur(12px)" });
            film.to(node, { opacity: 1, z: 0, filter: "blur(0px)", duration: .09, ease: "power2.out" }, enter);
            if (exit !== undefined) film.to(node, { opacity: 0, z: 260, filter: "blur(14px)", duration: .08, ease: "power2.in" }, exit);
          };
          film.fromTo(".scroll-progress span", { scaleX: 0 }, { scaleX: 1, ease: "none", duration: 1 }, 0)
            .to(".hero-copy", { opacity: 0, yPercent: -26, filter: "blur(14px)", duration: .17, ease: "power2.in" }, 0)
            .to(".cinema-rail", { opacity: 0, y: 28, duration: .2, ease: "power2.in" }, .06)
            .to(".cinema-grade", { opacity: 1, duration: 1, ease: "none" }, 0)
            .to(".image-viewer > .car-image", { scale: 1.9, opacity: 0, filter: "blur(9px)", duration: 1, ease: "power1.in" }, 0)
            .to(".cinema-sticky", { "--curtain": 1, duration: .12, ease: "power1.in" }, .88);
          chapter("01", .12, .28);
          chapter("02", .36, .52);
          chapter("03", .58, .72);
          chapter("04", .80);          // the interior panel is the destination, so it holds to the end
          ScrollTrigger.create({ trigger: root, start: "top top", end: "bottom 80px", onToggle: (self) => document.documentElement.classList.toggle("over-cinema", self.isActive) });
        }, root);
        return () => { heroScroll.set(0); document.documentElement.classList.remove("over-cinema"); context.revert(); };
      });
      document.fonts?.ready.then(() => { if (!disposed) ScrollTrigger.refresh(); });
    }).catch(() => {});
    return () => { disposed = true; heroScroll.set(0); document.documentElement.classList.remove("over-cinema"); media.revert(); };
  }, [scope, vehicle]);
}
