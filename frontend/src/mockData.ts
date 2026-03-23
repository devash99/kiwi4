export function getMockResponse(question: string): {
  answer: string;
  sql: string;
  rows: Record<string, string | number>[];
} {
  const q = question.toLowerCase();

  // FIX #21: Column names updated to match real DB schema
  // (full_name, roll_number, attendance_percentage, detention_status, etc.)

  if (q.includes('attendance') || q.includes('75')) {
    return {
      answer: "Here are the students with attendance below 75% in the ECE department this semester:",
      sql: `SELECT s.roll_number, s.full_name, a.attendance_percentage,\n  CASE WHEN a.attendance_percentage < 75 THEN 'Below 75%' END as status\nFROM students s\nJOIN attendance a ON s.student_id = a.student_id\nWHERE a.attendance_percentage < 75\nORDER BY a.attendance_percentage ASC\nLIMIT 100;`,
      rows: [
        { "Roll Number": "21ECE1045", "Full Name": "Arjun Mehta", "Attendance %": 58.2, "Status": "Critical" },
        { "Roll Number": "21ECE1078", "Full Name": "Priya Sharma", "Attendance %": 62.1, "Status": "Below 75%" },
        { "Roll Number": "22ECE1032", "Full Name": "Ravi Kumar", "Attendance %": 67.5, "Status": "Below 75%" },
        { "Roll Number": "22ECE1091", "Full Name": "Sneha Reddy", "Attendance %": 70.3, "Status": "Warning" },
        { "Roll Number": "21ECE1056", "Full Name": "Vikram Singh", "Attendance %": 73.8, "Status": "At Risk" },
      ],
    };
  }

  if (q.includes('structure') || q.includes('topped') || q.includes('highest')) {
    return {
      answer: "Here are the top scorers in Data Structures this semester:",
      sql: `SELECT s.roll_number, s.full_name, sm.sessional_total\nFROM students s\nJOIN sessional_marks sm ON s.student_id = sm.student_id\nJOIN subjects sub ON sm.subject_id = sub.subject_id\nWHERE sub.subject_name ILIKE '%Data Structures%'\nORDER BY sm.sessional_total DESC\nLIMIT 3;`,
      rows: [
        { "Roll Number": "22ECE1012", "Full Name": "Ananya Iyer", "Sessional Total": 97 },
        { "Roll Number": "22ECE1034", "Full Name": "Karthik Nair", "Sessional Total": 94 },
        { "Roll Number": "21ECE1023", "Full Name": "Meera Joshi", "Sessional Total": 91 },
      ],
    };
  }

  if (q.includes('detention') || q.includes('risk')) {
    return {
      answer: "The following students are currently at risk of detention based on attendance:",
      sql: `SELECT s.roll_number, s.full_name, a.attendance_percentage, a.detention_status\nFROM students s\nJOIN attendance a ON s.student_id = a.student_id\nWHERE a.attendance_percentage < 75\nORDER BY a.attendance_percentage ASC\nLIMIT 100;`,
      rows: [
        { "Roll Number": "21ECE1045", "Full Name": "Arjun Mehta", "Attendance %": 58.2, "Detention": "Detained" },
        { "Roll Number": "22ECE1067", "Full Name": "Deepak Patel", "Attendance %": 71.0, "Detention": "At Risk" },
        { "Roll Number": "21ECE1089", "Full Name": "Lakshmi Rao", "Attendance %": 74.1, "Detention": "At Risk" },
      ],
    };
  }

  if (q.includes('cgpa') || q.includes('section') || q.includes('performance') || q.includes('compare')) {
    return {
      answer: "Here's the section-wise average attendance comparison across all years in the ECE department:",
      sql: `SELECT s.year, s.section,\n  ROUND(AVG(a.attendance_percentage)::numeric, 2) as avg_attendance,\n  COUNT(DISTINCT s.student_id) as student_count\nFROM students s\nJOIN attendance a ON s.student_id = a.student_id\nGROUP BY s.year, s.section\nORDER BY s.year, s.section;`,
      rows: [
        { "Year": 1, "Section": "A", "Avg Attendance": 78.2, "Students": 62 },
        { "Year": 1, "Section": "B", "Avg Attendance": 74.5, "Students": 60 },
        { "Year": 2, "Section": "A", "Avg Attendance": 79.1, "Students": 58 },
        { "Year": 2, "Section": "B", "Avg Attendance": 72.3, "Students": 61 },
        { "Year": 3, "Section": "A", "Avg Attendance": 81.2, "Students": 55 },
        { "Year": 3, "Section": "B", "Avg Attendance": 76.8, "Students": 59 },
        { "Year": 4, "Section": "A", "Avg Attendance": 83.4, "Students": 52 },
        { "Year": 4, "Section": "B", "Avg Attendance": 79.7, "Students": 54 },
      ],
    };
  }

  return {
    answer: "I can help you with a variety of campus intelligence queries! Here's what KIWI can do:\n\n• **Attendance Tracking** — Find students below attendance thresholds, department-wise reports\n• **Academic Performance** — Top scorers, sessional marks analysis\n• **Detention Monitoring** — Identify at-risk students based on attendance\n• **Section Comparisons** — Compare performance across sections, years\n\nTry asking something like \"Show me students with attendance below 75%\" or \"Which students are at risk of detention?\"",
    sql: "",
    rows: [],
  };
}
