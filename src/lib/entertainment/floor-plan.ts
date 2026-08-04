import {
  events,
} from "../events";
import type { LocalEntertainmentEvent } from "./domain";

export function getLocalEntertainmentEvents(): LocalEntertainmentEvent[] {
  return events.map((event) => ({
    id: String(event.id),
    name: event.name,
    date: event.date,
    color: event.color,
    rooms: [...event.rooms],
    eventTime: event.time,
    entertainment: event.entertainment.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      time: item.time,
    })),
  }));
}
