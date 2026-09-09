<?php
// CLI-only fixture for a dedicated synthetic Moodle installation. No quiz submission.
declare(strict_types=1);
define('CLI_SCRIPT', true);

function require_lab(bool $condition): void {
    if (!$condition) {
        throw new RuntimeException('lab_contract_refused');
    }
}

function fixture_pdf(string $text): string {
    $stream = "BT /F1 12 Tf 40 780 Td (" . $text . ") Tj ET\n";
    $objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' . strlen($stream) . ">>\nstream\n" . $stream . 'endstream',
    ];
    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    foreach ($objects as $index => $object) {
        $offsets[] = strlen($pdf);
        $pdf .= ($index + 1) . " 0 obj\n" . $object . "\nendobj\n";
    }
    $xref = strlen($pdf);
    $pdf .= "xref\n0 6\n0000000000 65535 f \n";
    foreach (array_slice($offsets, 1) as $offset) {
        $pdf .= sprintf("%010d 00000 n \n", $offset);
    }
    return $pdf . "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n";
}

try {
    $input = json_decode(stream_get_contents(STDIN, 16385), true, 16, JSON_THROW_ON_ERROR);
    require_lab(is_array($input) && in_array($input['operation'] ?? '', ['seed', 'inspect', 'reset'], true));
    require_lab(isset($argv[1]) && is_file($argv[1]));
    require($argv[1]);
    require_lab(($CFG->sb_lab_enabled ?? false) === true);
    require_lab(($CFG->dbname ?? '') === 'sb_moodle_lab');
    require_lab(preg_match('/^[a-f0-9]{32}$/D', $input['instance'] ?? '') === 1);
    require_lab(hash_equals($CFG->sb_lab_instance ?? '', $input['instance']));
    require_lab(($CFG->noreplyaddress ?? '') === 'noreply@example.invalid');
    require_lab(!empty($CFG->noemailever));
    require_once($CFG->libdir . '/testing/generator/lib.php');
    require_once($CFG->dirroot . '/course/lib.php');
    require_once($CFG->dirroot . '/user/lib.php');
    \core\session\manager::set_user(get_admin());

    $shortname = 'SB-LAB-001';
    $revision = 'study-buddy-moodle-v1';
    $facts = 'Synthetic study fixture. The test vehicle has mass 12 kg and acceleration 3 m/s^2. Its net force is 36 N.';
    $files = [
        'fixture-notes.txt' => $facts . "\nReference marker: SB-LAB-NOTES-V1\n",
        'fixture-handout.pdf' => fixture_pdf('SB-LAB-PDF-V1: mass 12 kg; acceleration 3 m/s^2; net force 36 N.'),
    ];
    $course = $DB->get_record('course', ['shortname' => $shortname]);
    $operation = $input['operation'];
    $students = [];
    foreach (['windows', 'fedora'] as $lane) {
        $student = $DB->get_record('user', ['username' => 'sb-lab-' . $lane, 'deleted' => 0]);
        if ($student) {
            require_lab($student->idnumber === $revision . ':' . $lane);
            require_lab(!is_siteadmin($student));
        }
        $students[$lane] = $student;
        if ($operation !== 'inspect') {
            $password = $input['passwords'][$lane] ?? '';
            require_lab(is_string($password) && strlen($password) >= 24 && strlen($password) <= 128);
        }
    }
    if ($course) {
        require_lab($course->idnumber === $revision);
    }
    if ($operation === 'reset') {
        require_lab(($input['confirm'] ?? '') === 'reset-synthetic-course-only');
        require_lab((bool)$course);
        // Refuse a site that has acquired unrelated course data. Never reset the database.
        require_lab($DB->count_records_select('course', 'id <> :site AND shortname <> :fixture',
            ['site' => SITEID, 'fixture' => $shortname]) === 0);
        delete_course($course, false);
        $course = false;
    } elseif ($operation === 'seed') {
        require_lab(!$course); // Already seeded: inspect, or explicitly request guarded reset.
    }

    if ($operation !== 'inspect') {
        $generator = new testing_data_generator();
        foreach ($students as $lane => $student) {
            if (!$student) {
                $student = $generator->create_user([
                    'username' => 'sb-lab-' . $lane, 'password' => $input['passwords'][$lane],
                    'firstname' => 'Synthetic', 'lastname' => ucfirst($lane),
                    'email' => 'sb-lab-' . $lane . '@example.invalid',
                    'idnumber' => $revision . ':' . $lane, 'auth' => 'manual',
                    'confirmed' => 1, 'lang' => 'en',
                ]);
                $students[$lane] = $student;
            } else {
                update_internal_user_password($student, $input['passwords'][$lane]);
            }
        }
        $course = $generator->create_course([
            'shortname' => $shortname, 'fullname' => 'Study Buddy Synthetic Test Course',
            'idnumber' => $revision, 'format' => 'topics', 'numsections' => 1,
            'visible' => 1, 'enablecompletion' => 0, 'newsitems' => 0,
            'summary' => 'Synthetic fixtures only. Not university material.',
        ]);
        $generator->create_module('page', [
            'course' => $course->id, 'section' => 1, 'name' => 'Known facts',
            'content' => '<p>' . $facts . '</p><p>SB-LAB-PAGE-V1</p>', 'contentformat' => FORMAT_HTML,
        ]);
        $folder = $generator->create_module('folder', [
            'course' => $course->id, 'section' => 1, 'name' => 'Synthetic documents',
        ]);
        $context = context_module::instance($folder->cmid);
        foreach ($files as $filename => $bytes) {
            get_file_storage()->create_file_from_string([
                'contextid' => $context->id, 'component' => 'mod_folder', 'filearea' => 'content',
                'itemid' => 0, 'filepath' => '/', 'filename' => $filename,
            ], $bytes);
        }
        foreach ($students as $student) {
            require_lab($generator->enrol_user($student->id, $course->id, 'student', 'manual'));
        }
        rebuild_course_cache($course->id, true);
    }

    require_lab((bool)$course);
    $page = $DB->get_record('page', ['course' => $course->id, 'name' => 'Known facts'], '*', MUST_EXIST);
    require_lab(str_contains($page->content, $facts) && str_contains($page->content, 'SB-LAB-PAGE-V1'));
    $pagecm = get_coursemodule_from_instance('page', $page->id, $course->id, false, MUST_EXIST);
    $folder = $DB->get_record('folder', ['course' => $course->id, 'name' => 'Synthetic documents'], '*', MUST_EXIST);
    $foldercm = get_coursemodule_from_instance('folder', $folder->id, $course->id, false, MUST_EXIST);
    $context = context_module::instance($foldercm->id);
    $manifest = [];
    foreach ($files as $filename => $bytes) {
        $file = get_file_storage()->get_file($context->id, 'mod_folder', 'content', 0, '/', $filename);
        require_lab((bool)$file && hash_equals(hash('sha256', $bytes), hash('sha256', $file->get_content())));
        $manifest[] = [
            'name' => $filename, 'sha256' => hash('sha256', $bytes), 'size' => strlen($bytes),
            'url' => (string)moodle_url::make_pluginfile_url($context->id, 'mod_folder', 'content', 0, '/', $filename, true),
        ];
    }
    foreach ($students as $student) {
        require_lab((bool)$student && is_enrolled(context_course::instance($course->id), $student));
        require_lab(!has_capability('moodle/site:config', context_system::instance(), $student));
    }
    echo json_encode([
        'ok' => true, 'fixtureRevision' => $revision, 'moodleRelease' => $CFG->release,
        'courseUrl' => (string)new moodle_url('/course/view.php', ['id' => $course->id]),
        'pageUrl' => (string)new moodle_url('/mod/page/view.php', ['id' => $pagecm->id]),
        'folderUrl' => (string)new moodle_url('/mod/folder/view.php', ['id' => $foldercm->id]),
        'files' => $manifest, 'studentPrivilegesVerified' => true,
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
} catch (Throwable $error) {
    // Do not serialize exceptions: Moodle/DB diagnostics may contain private configuration.
    fwrite(STDERR, "Moodle fixture operation failed or target guard refused.\n");
    exit(1);
}
