/** Window events shared by the tour, the rail and the Guide page. */
export const TOUR_START = "store-register:tour-start";
export const RAIL_OPEN = "store-register:rail-open";

export function startTour() {
  window.dispatchEvent(new Event(TOUR_START));
}

export function setRailOpen(open: boolean) {
  window.dispatchEvent(new CustomEvent<boolean>(RAIL_OPEN, { detail: open }));
}
