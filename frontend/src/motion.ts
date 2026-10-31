import { useEffect, useLayoutEffect, type RefObject } from "react";
import { gsap } from "gsap";

export function usePageMotion(scope: RefObject<HTMLElement>, route: string) {
  useEffect(() => {
    if (!scope.current || typeof IntersectionObserver === "undefined" || typeof window.matchMedia !== "function") return;
    const root = scope.current;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const context = gsap.context(() => {}, root);
      const seen = new WeakSet<Element>();
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }, index) => {
          if (!isIntersecting) return;
          observer.unobserve(target);
          const vehicle = target.getAttribute("data-reveal") === "vehicle";
          context.add(() => gsap.fromTo(target, { opacity: 0.2, x: vehicle ? 45 : 0, y: vehicle ? 0 : 20 }, { opacity: 1, x: 0, y: 0, duration: vehicle ? .8 : .6, delay: Math.min(index, 3) * .06, ease: "power3.out", clearProps: "transform,opacity" }));
        });
      }, { threshold: 0.08 });
      const collect = () => root.querySelectorAll("[data-reveal], .page-heading, .panel, .table-scroll, .msg, .summary li, .specs > div, .section-heading, .budget-tile, .brand-grid, .advisor-banner, .how-it-works .grid > div").forEach((node) => {
        if (!seen.has(node)) { seen.add(node); observer.observe(node); }
      });
      collect();
      const mutations = new MutationObserver(collect);
      mutations.observe(root, { childList: true, subtree: true });
      const revealFocus = (event: FocusEvent) => {
        const node = (event.target as HTMLElement).closest<HTMLElement>("[data-reveal], .panel, .msg");
        if (node) { observer.unobserve(node); gsap.killTweensOf(node); gsap.set(node, { clearProps: "transform,opacity" }); }
      };
      root.addEventListener("focusin", revealFocus);
      return () => { observer.disconnect(); mutations.disconnect(); root.removeEventListener("focusin", revealFocus); context.revert(); };
    });
    return () => media.revert();
  }, [scope, route]);
}

export function useHeroMotion(scope: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    if (!scope.current || typeof window.matchMedia !== "function") return;
    let disposed = false;
    const root = scope.current;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const context = gsap.context(() => {
        gsap.fromTo(".hero-title-inner, .hero-description > span, .hero-actions", { opacity: 0, y: 25 }, { opacity: 1, y: 0, stagger: .1, duration: .85, ease: "power3.out", clearProps: "transform,opacity" });
      }, root);
      return () => context.revert();
    });
    import("gsap/ScrollTrigger").then(({ ScrollTrigger }) => {
      if (disposed) return;
      gsap.registerPlugin(ScrollTrigger);
      media.add("(min-width: 900px) and (min-height: 720px) and (prefers-reduced-motion: no-preference)", () => {
        const context = gsap.context(() => {
          const timeline = gsap.timeline({ scrollTrigger: { trigger: root, start: "top 90px", end: "bottom bottom", scrub: .65, invalidateOnRefresh: true } });
          timeline.to(".hero-copy .eyebrow", { y: -25, opacity: 0, ease: "none" }, 0)
            .to(".hero-title", { y: -35, scale: .92, opacity: 0, ease: "none" }, 0)
            .to(".hero-description", { y: -20, opacity: 0, ease: "none" }, 0)
            .to(".cinema-object", { xPercent: 8, y: -75, scale: 1.12, rotation: -2, ease: "none" }, 0)
            .to(".cinema-floor", { scale: 1.3, opacity: .4, ease: "none" }, 0)
            .fromTo(".scroll-progress span", { scaleX: 0 }, { scaleX: 1, ease: "none" }, 0);
        }, root);
        return () => context.revert();
      });
      document.fonts?.ready.then(() => { if (!disposed) ScrollTrigger.refresh(); });
    }).catch(() => {});
    return () => { disposed = true; media.revert(); };
  }, [scope]);
}
