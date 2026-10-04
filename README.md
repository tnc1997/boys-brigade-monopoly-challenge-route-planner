# Boys' Brigade Monopoly Challenge Route Planner

A phone-friendly route planner for the Boys' Brigade Monopoly Challenge in Bristol. Enter the list of locations at the start, and it plans a walking route that scores as many points as possible from group selfies before the deadline, ending at the finish if there is one. During the day you can tick off selfies, see the route and your position on a map, change the pace and re-plan from wherever you are.

**Open it on your phone:** https://tnc1997.github.io/boys-brigade-monopoly-challenge-route-planner/

This is an unofficial tool made by a team taking part. It isn't run or endorsed by the Boys' Brigade, and the challenge's own rules and instructions always come first.

Open it once with signal before the challenge starts. After that it works without signal too, apart from the map's background and looking up new addresses.

## On the day

### 1. Set up

1. Open the planner and check the **Start** (Castle Park's coordinates by default), **Deadline** (16:00), **Walking speed** and **Selfie time**. Set the walking speed to the pace of the slowest walker, because the team must stay together.
2. Leave **Finish** blank if there's no finish point. Otherwise, enter it in the same way as a location (see below). You can add, change or clear it later.
3. Leave **Start time** blank to start now, or enter the time you'll set off.
4. Type the locations into **Locations**, one per row. A new empty row appears as you fill in the last one, and **Enter** moves to the next row. Enter every location before planning, for the most accurate route.
5. Press **Plan route**. If some locations are still being looked up, the button says so and plans as soon as they're done. It then says how many stops it planned, lists any locations that weren't found, and moves to the route.

### 2. Writing each location

Type each location as it's given on the sheet, such as a street or place in Bristol, like `Queen Square`. The row's text is also what the location is called in the route and on the map.

Each row is looked up with OpenStreetMap when you've finished it: when you press **Enter** or move to another field. Never while you're typing. Underneath, it shows:

- **Searching…** while it's being looked up.
- **Found:** and the place it found. Check it's the right one, since a street name usually finds somewhere along the street rather than the exact spot.
- **Not found.** Check the spelling, or pin it on the map (see below). Locations that aren't found are left out of the route.
- **Couldn't search**, usually because there's no signal. It tries again when the phone is back online, or when you press **Plan route**.

**Pin a location on the map** when it isn't found, or isn't quite in the right spot. Tap the row's 📍, then tap where it is on the map. The row keeps its name and shows **📍 Pinned on the map**. Changing a pinned row's text only renames it. To look it up again instead, tap the ✕ next to **Pinned on the map**.

**Or add a location from the map.** On the **Map** tab, long-press the spot (or right-click it on a computer). Give it a name if you like, or leave it blank to call it "Location 4", say, after its place in the list. It's added to the end of **Locations** as a pinned row.

Rows you add after planning show on the map as a dashed **+** until you press **Plan route** or **Re-plan from here**. To remove a location, tap the row's ✕, and plan again if it's already in the route.

**Must visit.** For a location the route has to include, tap the row's **More** and tick **Must visit**. The route then always includes it, even if leaving it out would score more points, and other stops are planned around it. If the must-visit locations alone can't be visited before the deadline (less the safety margin), the route is just them, in the shortest order, and a warning says when they'd finish. Untick some to fit others in. A location that's already ticked off doesn't need visiting again, so Must visit no longer applies to it.

**Points.** If the sheet scores locations differently, set **Points per location** in **⚙ Settings** to what most are worth (10 by default), and enter any location's own value under its row's **More**, in **Points**. Leave Points blank to use Points per location. Once any location has its own points, each stop shows what it's worth and the route shows a total, like "Planned 22 stops · 230 points". The route scores as many points as it can, so it may skip two nearby locations for one far-off location worth more than both. Of routes worth the same, it picks the one with the most stops, then the quickest. After changing a location's points, press **Re-plan from here** to update the route; changing Points per location re-plans straight away.

**Coordinates** on their own (like `51.4545,-2.5879`, from long-pressing a spot in Google Maps) are used directly, without a lookup. Anything else on the row is looked up, so to give a location a name and an exact spot, type its name and pin it with 📍. In **Start** and **Finish**, coordinates on their own are called "Start" and "Finish". Google Maps links and what3words addresses can't be used: pin those locations on the map instead.

**Only one phone should look up a fresh list of addresses.** OpenStreetMap's free address search allows 1 request per second for everyone using the planner together, and the planner waits 1.5 seconds between lookups. If several phones enter the same new list at once, they can go over that limit. Each phone saves its results, so each location is only looked up once and re-planning works without signal. See the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

### 3. Follow the route

- The **List** tab shows each stop in order with its ETA, the walk to it, and a **Google Maps** button that opens walking directions. On an iPhone, iPad or Mac there's also an **Apple Maps** button. Locations that don't fit are listed under **Skipped**.
- The **Map** tab shows the numbered stops, the route line, the finish, skipped locations in grey, and your position as a blue dot.
- After each selfie, tap **Mark selfie done**. The counter shows how many are done.
- If the organisers have an online check-in form and its link is in the settings, tap **Check in** instead. It opens the form in a new tab and marks the selfie done. If you open the form another way, such as from a long-press menu, tap **Mark selfie done** as well. Check in straight away, because the first team to upload at a location gets a bonus.
- The header shows a countdown to the deadline. A red banner warns you when time is nearly up ("Head to the finish now", or "Last few selfies" without a finish), or when you're running behind the plan.

### 4. Re-plan when things change

Press **Re-plan from here** at any time. It plans again from where you are now and the current time, using only the locations you haven't ticked off. Do this:

- **After a bus or train:** re-plan from where you get off.
- **When you're running behind,** or the red banner says so.
- **When the pace changes,** for example if people leave or the group tires. Open **⚙ Settings**, choose **Slow** (3.5 km/h), **Medium** (4.5 km/h), **Fast** (5.5 km/h) or use the slider, then press **Save and re-plan**.
- **When the finish changes.** The settings panel also lets you change the selfie time, safety margin (spare time kept before the deadline), detour factor (how much further walking is than a straight line), deadline and Points per location. It also has a place for the link to the organisers' online check-in form. With one set, each stop gets a **Check in** button, and the default selfie time goes up from 3 to 5 minutes to allow for uploading. A selfie time you've set yourself is kept.

The line under the Route heading shows what the plan assumes, such as "Planning for Medium 4.5 km/h · 3 min/selfie".

To start over with a new list, press **New challenge**. It keeps your settings, and forgets which locations weren't found, so they're looked up again.

## Rules to remember

- **Stay together at all times.** The planner plans one route for the whole team.
- **Allowed:** walking, buses and trains.
- **Not allowed:** bikes, e-scooters, cars, taxis and Ubers.
- **Be at the finish by the deadline** (16:00).

The planner only knows about walking. If you take a bus or train, press **Re-plan from here** once you get off.

## How it works

- **Planning:** the planner estimates walking time from the straight-line distance multiplied by the detour factor, at the walking speed, plus the selfie time at each stop. It builds a route by adding the location that scores the most points for each second of extra time, then improves it by reversing sections (2-opt) and by swapping one stop for others. It repeats this from several starting points, all within 200 ms, and keeps the best route.
- **Your data stays on the phone:** everything you enter is saved in the browser only.
- **External services:** address searches go to [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org/), and map tiles come from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors). Both are free within their usage policies, which the code follows.

## Development

The site is static, with no framework. The modules are plain JavaScript with JSDoc, and Tailwind CSS generates `styles.css`.

```sh
npm install   # install the dev tools
npm start     # serve on http://localhost:3000 and rebuild the styles as you edit
npm test      # run the tests with node --test
npm run build # build the minified styles.css
```

| File | What it does |
|---|---|
| `index.html`, `app.js` | The page and the code that runs it |
| `planner.js` | Walking times and route planning |
| `locations.js` | The location list's rows, and where each one is |
| `search.js` | Address lookups with Nominatim |
| `setup.js` | Turning the setup form into a plan |
| `route.js` | Describing the plan for the list, the map, the warning banner and the countdown |
| `map.js` | The Leaflet map |
| `settings.js` | Walking speed presets, the settings summary and checking the check-in form URL |
| `storage.js` | Saving the state in the browser |
| `sw.js` | The service worker that keeps the app working offline |

Pushes to `main` are tested by the **Test** workflow and deployed to GitHub Pages by the **Deploy** workflow.
