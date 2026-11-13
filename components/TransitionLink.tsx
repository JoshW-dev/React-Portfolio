"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ComponentProps, type MouseEvent } from "react";
import { routeRendered } from "./PageTransition";

type LinkProps = ComponentProps<typeof Link>;
type NavigateEvent = Parameters<NonNullable<LinkProps["onNavigate"]>>[0];

/*
  The page transition, by destination:
  "open"  any project page. The new page wipes in from the top over the old one.
  "close" the home page or the projects list, from a project. The same wipe from the bottom.
  "fade"  everything else, a short cross-fade.
  globals.css reads the name from data-vt on <html>.
*/
type Kind = "open" | "close" | "fade";

const PROJECT = /^\/projects\/[^/]+\/?$/;

function kindOf(from: string, to: string): Kind {
  if (PROJECT.test(to)) return "open";
  if (PROJECT.test(from) && (to === "/" || to === "/projects")) return "close";
  return "fade";
}

// Read as optional: browsers without the View Transitions API do not have it.
type StartViewTransition = (this: Document, update: () => Promise<void>) => ViewTransition;

let current = 0;

function transitionsOn(): StartViewTransition | null {
  const start = (document as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== "function") return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  return start;
}

/**
  A link that moves to another page of this site with the site's page transition. It renders
  next/link, so prefetching, modified clicks and new tabs behave as usual. Without the View
  Transitions API, or with reduced motion on, it navigates like a plain next/link.
*/
export default function TransitionLink({ onClick, onNavigate, ...props }: LinkProps) {
  const router = useRouter();
  const target = useRef<URL | null>(null);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    target.current = null;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.currentTarget;
    if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    target.current = url;
  }

  // next/link calls this only for a same-site click it is about to route itself.
  function handleNavigate(event: NavigateEvent) {
    let stopped = false;
    onNavigate?.({
      preventDefault: () => {
        stopped = true;
        event.preventDefault();
      },
    });
    const url = target.current;
    target.current = null;
    if (stopped || !url) return;

    const start = transitionsOn();
    if (!start) return;
    event.preventDefault();

    const id = ++current;
    const root = document.documentElement;
    const kind = kindOf(window.location.pathname, url.pathname);
    const href = url.pathname + url.search + url.hash;
    const options = { scroll: props.scroll !== false };
    root.dataset.vt = kind;
    delete root.dataset.vtEdge;

    const transition = start.call(document, async () => {
      const rendered = routeRendered();
      // The line exists only in the new picture, so it is set after the old one is taken.
      if (kind !== "fade") root.dataset.vtEdge = "";
      if (props.replace) router.replace(href, options);
      else router.push(href, options);
      // On a timeout the snapshot would still be the old page, so the animation is dropped.
      if (!(await rendered)) transition.skipTransition();
    });

    const clear = () => {
      if (id !== current) return;
      delete root.dataset.vt;
      delete root.dataset.vtEdge;
    };
    transition.ready.catch(() => undefined);
    transition.updateCallbackDone.catch(() => undefined);
    transition.finished.then(clear, clear);
  }

  return <Link {...props} onClick={handleClick} onNavigate={handleNavigate} />;
}
