const { Router } = require('express');
const personas = require('./personas');
const snapshots = require('./snapshots');
const calibration = require('./calibration');
const drift = require('./drift');
const sessions = require('./sessions');

const router = Router();

router.use('/personas', personas);
router.use('/snapshots', snapshots);
router.use('/calibration', calibration);
router.use('/drift', drift);
router.use('/sessions', sessions);

module.exports = router;
