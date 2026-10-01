# self-driving-car

A small neural network that taught itself to drive a curvy three-lane highway through traffic, by evolution, in plain JavaScript.

<p align="center">
  <a href="https://stxqq.github.io/self-driving-car/"><img src=".github/assets/hero.gif" width="880" alt="The pretrained car overtaking traffic on a curving highway, with its sensor rays and the network that drives it"></a>
</p>

<p align="center">
  <a href="https://github.com/Stxqq/self-driving-car/actions/workflows/ci.yml"><img src="https://github.com/Stxqq/self-driving-car/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="https://stxqq.github.io/self-driving-car/"><img src="https://img.shields.io/badge/demo-live-2563eb?style=flat&labelColor=111113" alt="live demo"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-9a9aa2?style=flat&labelColor=111113" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-16a34a?style=flat&labelColor=111113" alt="node 22 or newer">
  <img src="https://img.shields.io/badge/dependencies-0-f59e0b?style=flat&labelColor=111113" alt="no dependencies">
</p>

Nobody shows the network how to drive. Each generation, a population of
networks takes to the same stretch of road; the ones that get furthest
become the parents of the next. The page lets you watch the trained driver,
evolve your own from random weights in the browser, or take the wheel
yourself while the network shows what it would have done.

There is no library underneath: the road, the car, the sensors, the traffic,
the network and the genetic algorithm are about 1,200 lines of ES modules
that run unchanged in the browser and in Node.

## How it works

<p align="center">
  <img src=".github/assets/how-it-works.png" width="880" alt="Diagram: sensors feed 32 inputs into a 32-20-10-2 network whose pedal and steer move the car every 1/60 s; each generation 60 cars drive one road, are scored by distance, and the best four seed the next">
</p>

Every 1/60 s the car reads its rays, the network turns 32 numbers into a
pedal and a steering command, and the car moves. The values in the diagram
are one real moment from the shipped brain, 20 seconds into a run.

- **Road.** A seeded highway built from clothoids, so curvature ramps
  smoothly and there are no kinks for the rays to trip on. It is generated
  lazily as the car drives.
- **Car.** A kinematic bicycle model in SI units (4.4 m long, 32 m/s top
  speed). Steer asks for a share of the available cornering grip rather than
  a wheel angle, so the same output means the same sideways pull at 30 km/h
  and at 110 km/h.
- **Sensors.** Eleven rays fan out ahead to 70 m, packed toward the nose,
  and three mirror rays look back 40 m. Each ray also reports how fast its
  reading is changing, because one frame of distances can't tell a parked
  car from one doing 100 km/h.
- **Traffic.** Background cars follow the Intelligent Driver Model, keep to
  speed bands per lane and overtake on the left. Traffic never sees the
  learning cars and never makes room for them. That keeps a seed fully
  deterministic however many cars are learning on it, and it makes the task
  harder: cars cut in ahead and occasionally run into you from behind.
- **Fitness.** Meters of road covered, minus 300 for crashing or for being
  caught by a line that sweeps up the road at 18 km/h.
- **Evolution.** Elitism (the best four carry over), tournament selection,
  BLX-0.25 blend crossover and gaussian mutation whose rate and size decay
  with a 40-generation half-life.

The simulation is deterministic down to the last bit: same seed, same
brains, same trajectories, on every Node release from 20 to 25. (It avoids
`**` in the physics for that reason; V8 changed its `pow` between releases.) The test suite
replays all 30 held-out runs and checks them to the meter.

<p align="center">
  <img src=".github/assets/anatomy.png" width="440" alt="The page's spec sheet of the car in focus: sensors, network, controls, fitness, drawn live">
</p>

## Quickstart

```sh
git clone https://github.com/Stxqq/self-driving-car.git
cd self-driving-car
npm run serve          # python3 -m http.server 5101
```

Open <http://localhost:5101>. Any static server works; ES modules just don't
load from `file://`. Nothing to install, and `npm test` needs only Node 22 or
newer.

## Training from the command line

Training runs headless across worker threads. By default it writes to
`runs/brain.json`, so it never touches the shipped brain:

```console
$ node scripts/train.mjs --generations 15 --population 120 --seeds 3 --seconds 60 --density 0
13 workers, population 120, 3 seeds x 60 s, traffic x0
 gen   best m   mean m  alive    mut     s
   0      415       14      0  0.150   0.2
   1      833       26      0  0.148   0.1
   ...
  13     1721      137      1  0.126   0.1
  14     1124      105      0  0.124   0.1
      validation 1406 m, saved runs/brain.json
done in 0.0 min, best validation 1406 m
```

`--density` scales the traffic, so a driver can learn to hold a lane at speed
on an empty road before meeting anyone. `--resume` starts from the brain at
`--out` with gentler mutation. The schedule behind the shipped brain is
`scripts/curriculum.sh`: empty road, traffic faded in over four stages, then
five-minute episodes on full traffic. Its last two stages took 10 and 18
minutes on a 14-core laptop.

To score a brain on roads it has never seen:

```console
$ node scripts/evaluate.mjs --seeds 9001,9002,9003,9004,9005
 seed   meters      s   km/h  ended
 9001     4716  300.0   56.6  time
 9002     1792  119.8   53.8  crashed
 9003     4659  300.0   55.9  time
 9004     4723  300.0   56.7  time
 9005     4739  300.0   56.9  time
mean 4126 m, median 4716 m, 4 of 5 still on the road at the end
```

Brains trained in the page can be exported as JSON and loaded back with
Import, or passed to `evaluate.mjs --brain`.

## Results

The shipped brain (`src/brains/pretrained.json`, 892 weights) on 30 seeds it
was never trained or validated on, five minutes each, full traffic:

| | |
|---|---|
| Mean distance | 4.05 km |
| Median distance | 4.66 km |
| Still on the road after five minutes | 20 of 30 |
| Average speed | 56 km/h |
| Shortest run | 1.39 km |

Every number comes from `npm run evaluate -- --write`, which writes
`scripts/results.json`; the page reads the same file. A run that survives
covers about 4.7 km, so the mean is pulled down by the ten crashes. It
likes to live in the fast lane, and that is where all ten happen: seven are
traffic changing lanes while level with it or just ahead (traffic doesn't
look for it), three are slower cars in its lane that it brakes for too late.
None of them is the road edge. Two runs out of three is an honest number for
a 32-input network on roads it has never seen, and there is room to do
better.

<p align="center">
  <img src=".github/assets/train.png" width="880" alt="Train mode: generation 31 of an in-browser run, with the best and mean distance per generation">
</p>

## Project layout

```
src/sim/       road, car, sensors, traffic, world, brain, evolution (no DOM)
src/render/    canvas stage, network view, anatomy spec sheet, svg chart
src/ui/        the page: sessions for watch, train and drive, storage, keys
src/brains/    pretrained.json
scripts/       train.mjs, curriculum.sh, evaluate.mjs, results.json
test/          node:test suites, including the held-out replay
```

## Credits

- The idea of a car with a fan of ray sensors feeding a small network, built
  from scratch in the browser, is the one Radu Mariescu-Istodor made popular
  with his JavaScript self-driving car course. This one swaps the fixed
  track for a procedural highway with modeled traffic and evolves a whole
  population, but the starting point is his.
- Traffic uses the Intelligent Driver Model from Treiber, Hennecke and
  Helbing, *Congested traffic states in empirical observations and
  microscopic simulations* (Phys. Rev. E, 2000).
- The car is the kinematic bicycle model as described in Kong, Pfeiffer,
  Schildbach and Borrelli, *Kinematic and dynamic vehicle models for
  autonomous driving control design* (IEEE IV, 2015).
- Blend crossover is BLX-α from Eshelman and Schaffer, *Real-coded genetic
  algorithms and interval-schemata* (1993).
- The look follows my portfolio; type is Inter by Rasmus Andersson.

## License

MIT © 2026 Stefan Carapic
