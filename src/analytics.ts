type UmamiEventData = Record<string, string | number | boolean | null | undefined>;
type UmamiPageviewPayload = (props: { url: string; title?: string }) => { url: string; title?: string };
type UmamiTrackPayload = string | UmamiPageviewPayload;

declare global {
  interface Window {
    umami?: {
      track: (eventName: UmamiTrackPayload, eventData?: UmamiEventData) => void;
      identify?: (data: UmamiEventData) => void;
    };
  }
}

let isInitialized = false;
let isUsingMock = false;

const WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID || import.meta.env.VITE_UMAMI_SECONDARY_WEBSITE_ID || '';
const SCRIPT_URL = import.meta.env.VITE_UMAMI_SCRIPT_URL || '';
const HOST_URL = import.meta.env.VITE_UMAMI_HOST_URL || import.meta.env.VITE_UMAMI_SECONDARY_HOST_URL || '';
const TELEMETRY_SCRIPT_URL = import.meta.env.VITE_UMAMI_TELEMETRY_SCRIPT_URL || '';

function isLocalEnvironment(): boolean {
  const { hostname, protocol } = window.location;
  return (
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    protocol === 'file:'
  );
}

function eventDataFromAttributes(element: Element): UmamiEventData {
  const eventData: UmamiEventData = {};
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith('data-umami-event-') && attr.name !== 'data-umami-event') {
      eventData[attr.name.replace('data-umami-event-', '')] = attr.value;
    }
  }
  return eventData;
}

function safeLabel(element: Element): string {
  const label =
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.textContent?.trim() ||
    element.getAttribute('name') ||
    element.getAttribute('value') ||
    'unknown';
  return label.replace(/\s+/g, ' ').slice(0, 80);
}

function installUmamiMock(): void {
  isUsingMock = true;
  window.umami = {
    track: (payload, eventData) => {
      if (typeof payload === 'function') {
        console.group('[Umami Mock] Pageview');
        console.table(payload({ url: window.location.pathname + window.location.search, title: document.title }));
        console.groupEnd();
        return;
      }
      console.group(`[Umami Mock] Event: ${payload}`);
      if (eventData) console.table(eventData);
      console.groupEnd();
    },
    identify: (data) => {
      console.group('[Umami Mock] Identify');
      console.table(data);
      console.groupEnd();
    },
  };
}

function installUmamiScripts(): void {
  if (!WEBSITE_ID || !SCRIPT_URL || document.querySelector(`script[data-website-id="${WEBSITE_ID}"]`)) return;

  const analyticsScript = document.createElement('script');
  analyticsScript.src = SCRIPT_URL;
  analyticsScript.defer = true;
  analyticsScript.setAttribute('data-website-id', WEBSITE_ID);
  if (HOST_URL) analyticsScript.setAttribute('data-host-url', HOST_URL);
  document.head.appendChild(analyticsScript);

  if (!TELEMETRY_SCRIPT_URL) return;
  const telemetryScript = document.createElement('script');
  telemetryScript.src = TELEMETRY_SCRIPT_URL;
  telemetryScript.defer = true;
  telemetryScript.setAttribute('data-website-id', WEBSITE_ID);
  if (HOST_URL) telemetryScript.setAttribute('data-host-url', HOST_URL);
  telemetryScript.setAttribute('data-sample-rate', '0.50');
  telemetryScript.setAttribute('data-mask-level', 'moderate');
  telemetryScript.setAttribute('data-max-duration', '300000');
  document.head.appendChild(telemetryScript);
}

function installManualEventBridge(): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const explicitEvent = target.closest('[data-umami-event]');
      if (explicitEvent) {
        if (isUsingMock) {
          const eventName = explicitEvent.getAttribute('data-umami-event') || 'C_Interaction';
          window.umami?.track(eventName, eventDataFromAttributes(explicitEvent));
        }
        return;
      }

      if (!window.umami || typeof window.umami.track !== 'function') return;
      if (window.location.pathname.startsWith('/admin')) return;

      const interactable = target.closest(
        'a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]',
      );
      if (!interactable) return;

      const tagName = interactable.tagName.toLowerCase();
      const role = interactable.getAttribute('role');
      const href = interactable.getAttribute('href');
      const eventData: UmamiEventData = {
        type: role ? `${tagName}[role="${role}"]` : tagName,
        label: safeLabel(interactable),
        path: window.location.pathname,
      };

      if (href) {
        eventData.href = href.startsWith('http') ? href : new URL(href, window.location.origin).pathname;
      }

      window.umami.track('C_Interaction', eventData);
    },
    { capture: true },
  );

  document.addEventListener(
    'change',
    (event) => {
      if (!window.umami || typeof window.umami.track !== 'function') return;
      if (window.location.pathname.startsWith('/admin')) return;

      const target = event.target;
      if (
        !(
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        )
      ) {
        return;
      }
      if (target.type === 'password' || target.type === 'email' || target.closest('[data-umami-event]')) return;

      window.umami.track('C_Input_Change', {
        type: target.type ? `${target.tagName.toLowerCase()}[type="${target.type}"]` : target.tagName.toLowerCase(),
        label: safeLabel(target),
        path: window.location.pathname,
      });
    },
    { capture: true },
  );
}

export function initAnalytics(): void {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  if (isLocalEnvironment()) {
    installUmamiMock();
  } else {
    installUmamiScripts();
  }

  installManualEventBridge();
}

export function trackPageView(path: string, title = document.title): void {
  if (!window.umami || typeof window.umami.track !== 'function') return;
  window.umami.track((props) => ({
    ...props,
    url: path,
    title,
  }));
}

export function identifyAnalytics(data: UmamiEventData): boolean {
  if (!window.umami || typeof window.umami.identify !== 'function') return false;
  window.umami.identify(data);
  return true;
}
