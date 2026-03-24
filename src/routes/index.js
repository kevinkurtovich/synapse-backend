const { Router } = require('express');
const personas = require('./personas');
const snapshots = require('./snapshots');
const calibration = require('./calibration');
const drift = require('./drift');
const sessions = require('./sessions');
const validations = require('./validations');

const router = Router();

router.use('/personas', personas);
router.use('/snapshots', snapshots);
router.use('/calibration', calibration);
router.use('/drift', drift);
router.use('/sessions', sessions);
router.use('/validations', validations);

module.exports = router;
