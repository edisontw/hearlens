#!/usr/bin/env node
import {characterizeCrossoverAB} from "../packages/dsp/offline-wdrc.ab.testkit.mjs";
if(process.argv.length!==2){
  console.error("Usage: node tools/characterize-crossover-ab.mjs");
  process.exitCode=2;
}else{
  console.log(JSON.stringify(characterizeCrossoverAB(),null,2));
}
