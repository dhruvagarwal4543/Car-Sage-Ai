type Listener = (progress: number) => void;

const listeners = new Set<Listener>();
let progress = 0;

// The hero canvas reads scroll from here instead of through props, so a scrub frame never re-renders React.
export const heroScroll = {
  get value() { return progress; },
  set(next: number) { progress = next; listeners.forEach((listener) => listener(next)); },
  subscribe(listener: Listener) { listeners.add(listener); listener(progress); return () => { listeners.delete(listener); }; },
};
