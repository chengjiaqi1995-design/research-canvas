import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { Transcription } from '../types';

interface CalendarViewProps {
  transcriptions: Transcription[];
  dateType: 'created' | 'event';
}

const CalendarView: React.FC<CalendarViewProps> = ({ transcriptions, dateType }) => {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 获取当前月份的第一天和最后一天
  const { year, month, firstDay, lastDay, daysInMonth } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=周日
    const lastDay = new Date(year, month + 1, 0).getDate();
    return { year, month, firstDay, lastDay, daysInMonth: lastDay };
  }, [currentDate]);

  // 按日期分组转录记录
  const dateMap = useMemo(() => {
    const map: { [date: string]: Transcription[] } = {};
    
    if (!transcriptions || transcriptions.length === 0) {
      return map;
    }
    
    transcriptions.forEach(item => {
      try {
        let dateStr: string;
        
        if (dateType === 'created') {
          dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
        } else {
          // 发生日期
          if (item.eventDate && item.eventDate !== '未提及') {
            // eventDate 格式可能是 YYYY/MM/DD 或其他格式
            try {
              const eventDate = new Date(item.eventDate.replace(/\//g, '-'));
              if (!isNaN(eventDate.getTime())) {
                dateStr = eventDate.toLocaleDateString('zh-CN');
              } else {
                dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
              }
            } catch {
              dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
            }
          } else {
            dateStr = new Date(item.createdAt).toLocaleDateString('zh-CN');
          }
        }

        if (!map[dateStr]) {
          map[dateStr] = [];
        }
        map[dateStr].push(item);
      } catch (error) {
        console.error('处理转录记录日期时出错:', error, item);
      }
    });
    
    return map;
  }, [transcriptions, dateType]);

  // 生成日历网格数据
  const calendarGrid = useMemo(() => {
    const grid: Array<{ day: number; date: string; hasData: boolean; isCurrentMonth: boolean }> = [];
    
    // 填充上个月的日期（占位）
    for (let i = 0; i < firstDay; i++) {
      grid.push({ day: 0, date: '', hasData: false, isCurrentMonth: false });
    }
    
    // 填充本月的日期
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = date.toLocaleDateString('zh-CN');
      const hasData = !!dateMap[dateStr] && dateMap[dateStr].length > 0;
      
      grid.push({
        day,
        date: dateStr,
        hasData,
        isCurrentMonth: true,
      });
    }
    
    return grid;
  }, [year, month, firstDay, daysInMonth, dateMap]);

  // 切换月份
  const changeMonth = (offset: number) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + offset);
      return newDate;
    });
    setSelectedDate(null);
  };

  // 点击日期
  const handleDateClick = (dateStr: string) => {
    if (dateMap[dateStr] && dateMap[dateStr].length > 0) {
      setSelectedDate(selectedDate === dateStr ? null : dateStr);
    }
  };

  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  const today = new Date().toLocaleDateString('zh-CN');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* 月份导航 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        marginBottom: 24,
        fontSize: 16,
        fontWeight: 500,
      }}>
        <LeftOutlined 
          onClick={() => changeMonth(-1)}
          style={{ cursor: 'pointer', padding: '4px 12px', color: '#666' }}
        />
        <span style={{ margin: '0 20px', minWidth: 120, textAlign: 'center' }}>
          {year}年{month + 1}月
        </span>
        <RightOutlined 
          onClick={() => changeMonth(1)}
          style={{ cursor: 'pointer', padding: '4px 12px', color: '#666' }}
        />
      </div>

      {/* 星期标题 */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(7, 1fr)',
        marginBottom: 8,
      }}>
        {weekDays.map(day => (
          <div 
            key={day}
            style={{
              textAlign: 'center',
              fontSize: 13,
              color: '#999',
              fontWeight: 500,
              padding: '8px 0',
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 日历网格 */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 1,
        background: '#f0f0f0',
        border: '1px solid #f0f0f0',
      }}>
        {calendarGrid.map((cell, idx) => {
          const isToday = cell.date === today;
          const isSelected = cell.date === selectedDate;
          
          return (
            <div
              key={idx}
              onClick={() => cell.isCurrentMonth && handleDateClick(cell.date)}
              style={{
                minHeight: 80,
                background: '#fff',
                padding: 8,
                cursor: cell.hasData ? 'pointer' : 'default',
                position: 'relative',
                borderTop: isToday ? '2px solid #1890ff' : 'none',
                backgroundColor: isSelected ? '#f0f5ff' : '#fff',
              }}
            >
              {cell.isCurrentMonth && (
                <>
                  <div style={{ 
                    fontSize: 14, 
                    color: isToday ? '#1890ff' : '#333',
                    fontWeight: isToday ? 500 : 400,
                  }}>
                    {cell.day}
                  </div>
                  {cell.hasData && (
                    <div style={{
                      position: 'absolute',
                      bottom: 8,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#1890ff',
                    }} />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 选中日期的记录列表 */}
      {selectedDate && dateMap[selectedDate] && (
        <div style={{ marginTop: 24, padding: 16, background: '#fafafa', borderRadius: 4 }}>
          <h4 style={{ fontSize: 14, marginBottom: 12, fontWeight: 500 }}>
            {selectedDate} ({dateMap[selectedDate].length}条)
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {dateMap[selectedDate].map(item => (
              <div
                key={item.id}
                onClick={() => navigate(`/transcription/${item.id}`)}
                style={{
                  padding: 10,
                  background: '#fff',
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: '1px solid #f0f0f0',
                }}
              >
                <div style={{ fontSize: 13, color: '#333', marginBottom: 4 }}>
                  {item.topic || '未提取主题'}
                </div>
                <div style={{ fontSize: 11, color: '#999' }}>
                  {(item as any).industry && (item as any).industry !== '未知' && (
                    <span>{(item as any).industry}</span>
                  )}
                  {item.organization && item.organization !== '未知' && (
                    <span style={{ marginLeft: 8 }}>· {item.organization}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;

